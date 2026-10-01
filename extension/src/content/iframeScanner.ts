import { createLogger } from '../utils/logger';

const MAX_IFRAMES = 40;

const log = createLogger('iframe');

export interface InaccessibleIframe {
  index: number;
  src: string;
  reason: string;
}

export interface IframeScanReport {
  total: number;
  accessible: Document[];
  inaccessible: InaccessibleIframe[];
}

function frameSrc(frame: Element): string {
  return frame.getAttribute('src') ?? frame.getAttribute('srcdoc') ?? '';
}

function accessFrameDocument(frame: Element): Document | null {
  try {
    const doc = (frame as HTMLIFrameElement).contentDocument;
    if (!doc) return null;
    if (!doc.documentElement) return null;
    return doc;
  } catch {
    return null;
  }
}

/**
 * Single-level iframe scan of one root. Nested frames are discovered when the
 * root collector walks the accessible documents themselves, so this never
 * recurses on its own.
 */
export function collectIframes(scope: Document | ShadowRoot): IframeScanReport {
  const state: IframeScanReport = { total: 0, accessible: [], inaccessible: [] };

  let frames: Element[];
  try {
    frames = Array.from(scope.querySelectorAll('iframe, frame'));
  } catch {
    return state;
  }

  for (const frame of frames) {
    if (state.total >= MAX_IFRAMES) break;
    state.total += 1;

    const doc = accessFrameDocument(frame);
    if (doc) {
      state.accessible.push(doc);
      continue;
    }

    const entry: InaccessibleIframe = {
      index: state.total,
      src: frameSrc(frame),
      reason: 'iframe inaccessible',
    };
    state.inaccessible.push(entry);
    log.debug('iframe inaccessible', { index: entry.index, src: entry.src });
  }

  return state;
}
