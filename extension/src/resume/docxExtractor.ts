import { unzipSync, strFromU8 } from 'fflate';

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

export function extractDocxText(buffer: ArrayBuffer): string {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buffer));
  } catch {
    throw new Error('Could not read DOCX file (is it a valid zip-based .docx?)');
  }

  const docXml = files['word/document.xml'];
  if (!docXml) {
    throw new Error('Not a valid DOCX file (missing word/document.xml)');
  }

  let xml = strFromU8(docXml);
  xml = xml.replace(/<w:tab\b[^>]*\/?>/g, '\t');
  xml = xml.replace(/<w:(br|cr)\b[^>]*\/?>/g, '\n');
  xml = xml.replace(/<\/w:p>/g, '\n');
  xml = xml.replace(/<[^>]+>/g, '');
  return decodeEntities(xml);
}