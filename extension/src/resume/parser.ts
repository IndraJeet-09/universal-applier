import { extractPdfText } from './pdfExtractor';
import { extractDocxText } from './docxExtractor';

export interface ResumeFileInput {
  buffer: ArrayBuffer;
  filename: string;
}

export type ResumeFormat = 'pdf' | 'docx' | 'txt';

export function detectFormat(filename: string): ResumeFormat {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  switch (ext) {
    case 'pdf':
      return 'pdf';
    case 'docx':
      return 'docx';
    case 'txt':
    case 'md':
    case 'text':
      return 'txt';
    default:
      throw new Error(
        `Unsupported resume format ".${ext}". Supported: PDF, DOCX, TXT. Convert legacy .doc to PDF first.`
      );
  }
}

export async function extractResumeText(file: ResumeFileInput): Promise<string> {
  const format = detectFormat(file.filename);

  switch (format) {
    case 'pdf': {
      const text = await extractPdfText(file.buffer);
      if (text.trim().length === 0) {
        throw new Error('PDF contained no extractable text (it may be a scanned image).');
      }
      return text;
    }
    case 'docx':
      return extractDocxText(file.buffer);
    case 'txt':
      return new TextDecoder('utf-8').decode(file.buffer);
  }
}