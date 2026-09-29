import type { FormAnalysis } from '@schemas/dom';
import { registerHandlers } from '../utils/messaging';
import { createLogger, setDebugMode } from '../utils/logger';
import { analyzeForm } from './semanticExtractor';
import { refreshRegistry, getRegistry } from './fieldRegistry';
import { observeFormChanges, stopObserving } from './mutationObserver';

const log = createLogger('content');

let lastAnalysis: FormAnalysis | null = null;
let observing = false;

registerHandlers({
  async 'content-ping'() {
    return { hasContentScript: true, url: window.location.href };
  },

  async 'scan-fields'() {
    const fields = refreshRegistry();
    return { fields };
  },

  async 'analyze-form'() {
    const analysis = analyzeForm();
    lastAnalysis = analysis;
    refreshRegistry();
    startObserving();
    return analysis;
  },

  async 'get-last-analysis'() {
    return lastAnalysis;
  },

  async 'rescan-form'() {
    const fields = refreshRegistry();
    const analysis = analyzeForm();
    lastAnalysis = analysis;
    return { analysis, fields };
  },

  async 'get-registry'() {
    return {
      fields: getRegistry().map((e) => e.field),
    };
  },

  async 'set-debug'(payload: { enabled: boolean }) {
    setDebugMode(payload.enabled);
    return { enabled: payload.enabled };
  },
});

function startObserving(): void {
  if (observing) return;
  observing = true;
  observeFormChanges((mutations) => {
    const added = mutations.reduce((sum, m) => sum + m.addedNodes.length, 0);
    log.debug('dom changed, re-scanning', { addedNodes: added });
    const fields = refreshRegistry();
    void chrome.runtime
      .sendMessage({ type: 'content-fields-updated', payload: { count: fields.length } })
      .catch(() => {
        /* background may be asleep; not critical */
      });
  });
}

export function stopContentObserving(): void {
  stopObserving();
  observing = false;
}

log.info('content script loaded', { url: window.location.href });