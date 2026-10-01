import { collectShadowRoots } from './shadowDomScanner';
import { collectIframes, type IframeScanReport } from './iframeScanner';

type ScanRoot = Document | ShadowRoot;

const MAX_ROOTS = 200;

let lastIframeReport: IframeScanReport | null = null;

/**
 * Collects every root the scanner must inspect:
 *
 *   document
 *     -> shadowRoot (+ nested shadowRoot)
 *     -> accessible iframe documents (+ their shadow roots and frames)
 *
 * Cross-origin iframes are recorded as inaccessible and never crash the scan.
 */
export function collectRoots(): ScanRoot[] {
  const roots: ScanRoot[] = [];
  const seen = new Set<ScanRoot>();
  const queue: ScanRoot[] = [document];
  const iframeReport: IframeScanReport = { total: 0, accessible: [], inaccessible: [] };

  while (queue.length > 0 && roots.length < MAX_ROOTS) {
    const root = queue.shift();
    if (!root || seen.has(root)) continue;
    seen.add(root);
    roots.push(root);

    for (const shadow of collectShadowRoots(root)) {
      if (!seen.has(shadow)) queue.push(shadow);
    }

    const frames = collectIframes(root);
    iframeReport.total += frames.total;
    iframeReport.accessible.push(...frames.accessible);
    iframeReport.inaccessible.push(...frames.inaccessible);
    for (const doc of frames.accessible) {
      if (!seen.has(doc)) queue.push(doc);
    }
  }

  lastIframeReport = iframeReport;
  return roots;
}

export function getLastIframeReport(): IframeScanReport | null {
  return lastIframeReport;
}
