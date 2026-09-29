import * as pdfjsLib from 'pdfjs-dist';

let workerConfigured = false;

function ensureWorker(): void {
  if (workerConfigured) return;
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf.worker.min.mjs');
  workerConfigured = true;
}

function joinTextItems(items: unknown[]): string {
  let out = '';
  for (const raw of items) {
    const item = raw as { str?: string; hasEOL?: boolean };
    if (typeof item.str !== 'string') continue;
    out += item.str;
    if (item.hasEOL) {
      out += '\n';
    } else if (!out.endsWith('\n') && !out.endsWith(' ')) {
      out += ' ';
    }
  }
  return out;
}

export async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  ensureWorker();
  const doc = await pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: false,
  }).promise;

  const pages: string[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      pages.push(joinTextItems(content.items as unknown[]));
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return pages.join('\n');
}