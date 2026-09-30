import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { detectFormat, extractResumeText } from '../../extension/src/resume/parser';

function toArrayBuffer(text: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(text);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildDocx(paragraphs: string[]): ArrayBuffer {
  const documentXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>',
    ...paragraphs.map(
      (p) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(p)}</w:t></w:r></w:p>`
    ),
    '</w:body></w:document>',
  ].join('');

  const zipped = zipSync({
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    ),
    'word/document.xml': strToU8(documentXml),
  });

  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
}

describe('detectFormat', () => {
  it('maps known extensions to formats', () => {
    expect(detectFormat('resume.pdf')).toBe('pdf');
    expect(detectFormat('Resume.DOCX')).toBe('docx');
    expect(detectFormat('resume.txt')).toBe('txt');
    expect(detectFormat('resume.md')).toBe('txt');
  });

  it('rejects unsupported legacy formats with guidance', () => {
    expect(() => detectFormat('resume.doc')).toThrow(/Unsupported resume format/);
    expect(() => detectFormat('resume.rtf')).toThrow(/PDF, DOCX, TXT/);
  });
});

describe('extractResumeText', () => {
  it('decodes plain text resumes', async () => {
    const text = 'Indrajeet Chouhan\nindrajeet@example-dev.io';
    const out = await extractResumeText({
      buffer: toArrayBuffer(text),
      filename: 'resume.txt',
    });
    expect(out).toContain('Indrajeet Chouhan');
  });

  it('extracts paragraphs from a docx package', async () => {
    const buffer = buildDocx([
      'Indrajeet Chouhan',
      'Senior Full-Stack Engineer',
      'indrajeet@example-dev.io',
      'Skills: TypeScript, Node.js, Redis',
    ]);
    const out = await extractResumeText({ buffer, filename: 'resume.docx' });
    expect(out).toContain('Indrajeet Chouhan');
    expect(out).toContain('Skills: TypeScript, Node.js, Redis');
    expect(out.split('\n').length).toBeGreaterThanOrEqual(4);
  });

  it('reports readable errors for corrupt docx files', async () => {
    await expect(
      extractResumeText({ buffer: toArrayBuffer('not a zip'), filename: 'resume.docx' })
    ).rejects.toThrow(/Could not read DOCX/);
  });

  it('reports readable errors when word/document.xml is missing', async () => {
    const zipped = zipSync({ 'word/other.xml': strToU8('<w:x/>') });
    const buffer = zipped.buffer.slice(
      zipped.byteOffset,
      zipped.byteOffset + zipped.byteLength
    ) as ArrayBuffer;
    await expect(
      extractResumeText({ buffer, filename: 'resume.docx' })
    ).rejects.toThrow(/missing word\/document\.xml/);
  });

  it('keeps pdf parsing routed to the pdf extractor', async () => {
    await expect(
      extractResumeText({ buffer: toArrayBuffer('%PDF-1.7 not really'), filename: 'resume.pdf' })
    ).rejects.toThrow();
  });
});
