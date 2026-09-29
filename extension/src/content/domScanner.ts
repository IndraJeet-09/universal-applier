export const INTERACTIVE_SELECTORS = [
  'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"])',
  'textarea',
  'select',
  '[role="textbox"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="radio"]',
  '[role="checkbox"]',
  '[role="searchbox"]',
  '[role="spinbutton"]',
  '[contenteditable="true"]',
].join(',');

const SKIP_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image']);

export function isInteractable(element: Element): boolean {
  if (element instanceof HTMLInputElement && SKIP_INPUT_TYPES.has(element.type)) {
    return false;
  }
  return isVisible(element);
}

export function isVisible(element: Element): boolean {
  if (!element.isConnected) return false;
  const style = getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function queryInteractive(root: ParentNode): Element[] {
  const found: Element[] = [];
  let matches: Element[];
  try {
    matches = Array.from(root.querySelectorAll(INTERACTIVE_SELECTORS));
  } catch {
    return found;
  }
  for (const el of matches) {
    if (isInteractable(el)) found.push(el);
  }
  return found;
}