export type DomChangeCallback = (mutations: MutationRecord[]) => void;

const DEFAULT_DEBOUNCE_MS = 350;
const MAX_DEBOUNCE_MS = 1500;

let observer: MutationObserver | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastBatchAt = 0;

function relevantMutation(mutation: MutationRecord): boolean {
  if (mutation.type === 'childList') {
    return mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0;
  }
  if (mutation.type === 'attributes') {
    const name = mutation.attributeName ?? '';
    return name === 'class' || name === 'style' || name.startsWith('aria-');
  }
  return false;
}

export function observeFormChanges(callback: DomChangeCallback): void {
  stopObserving();

  observer = new MutationObserver((mutations) => {
    const relevant = mutations.filter(relevantMutation);
    if (relevant.length === 0) return;

    const now = Date.now();
    const sinceLast = now - lastBatchAt;
    const delay = sinceLast < MAX_DEBOUNCE_MS ? DEFAULT_DEBOUNCE_MS : MAX_DEBOUNCE_MS;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      lastBatchAt = Date.now();
      callback(relevant);
    }, delay);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'aria-hidden', 'aria-disabled', 'aria-required'],
  });
}

export function stopObserving(): void {
  observer?.disconnect();
  observer = null;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}