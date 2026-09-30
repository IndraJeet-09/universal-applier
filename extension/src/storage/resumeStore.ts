import type { ResumeFormat } from '../resume/parser';

export interface StoredResumeFile {
  filename: string;
  format: ResumeFormat;
  mimeType: string;
  data: ArrayBuffer;
  size: number;
  uploadedAt: string;
}

const KEY = 'resume_file';

export async function saveResumeFile(file: StoredResumeFile): Promise<void> {
  await chrome.storage.local.set({ [KEY]: file });
}

export async function getResumeFile(): Promise<StoredResumeFile | null> {
  const result = await chrome.storage.local.get(KEY);
  return (result[KEY] as StoredResumeFile | undefined) ?? null;
}

export async function clearResumeFile(): Promise<void> {
  await chrome.storage.local.remove(KEY);
}

const MIME_BY_FORMAT: Record<ResumeFormat, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
};

export function guessMimeType(filename: string, format: ResumeFormat): string {
  if (format === 'txt' && /\.md$/i.test(filename)) return 'text/markdown';
  return MIME_BY_FORMAT[format];
}