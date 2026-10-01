const MAX_SHADOW_DEPTH = 10;
const MAX_ELEMENTS = 20000;

export function collectShadowRoots(root: Document | ShadowRoot, depth = 0): ShadowRoot[] {
  if (depth > MAX_SHADOW_DEPTH) return [];

  const shadowRoots: ShadowRoot[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let visited = 0;

  while (walker.nextNode() && visited < MAX_ELEMENTS) {
    visited += 1;
    const element = walker.currentNode as Element;
    const shadow = element.shadowRoot;
    if (shadow) {
      shadowRoots.push(shadow);
      shadowRoots.push(...collectShadowRoots(shadow, depth + 1));
    }
  }

  return shadowRoots;
}
