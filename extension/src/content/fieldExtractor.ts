export interface FieldSignals {
  label?: string;
  placeholder?: string;
  name?: string;
  type?: string;
  role?: string;
  autocomplete?: string;
  ariaLabel?: string;
  description?: string;
  surroundingText?: string;
  options?: string[];
  required: boolean;
  disabled: boolean;
  section?: string;
  rawMetadata: Record<string, unknown>;
}

function textOrNull(el: Element | null): string | undefined {
  const text = el?.textContent?.trim();
  return text && text.length > 0 ? text : undefined;
}

function getLabelledByText(element: Element): string | undefined {
  const labelledBy = element.getAttribute('aria-labelledby');
  if (!labelledBy) return undefined;
  const texts: string[] = [];
  for (const id of labelledBy.split(/\s+/)) {
    const target = document.getElementById(id);
    const text = textOrNull(target);
    if (text) texts.push(text);
  }
  return texts.length > 0 ? texts.join(' ') : undefined;
}

function getAriaDescription(element: Element): string | undefined {
  const describedBy = element.getAttribute('aria-describedby');
  if (describedBy) {
    const texts: string[] = [];
    for (const id of describedBy.split(/\s+/)) {
      const target = document.getElementById(id);
      const text = textOrNull(target);
      if (text) texts.push(text);
    }
    if (texts.length > 0) return texts.join(' ');
  }
  const ownDescription = element.getAttribute('aria-description');
  return ownDescription?.trim() || undefined;
}

export function getAssociatedLabel(element: HTMLElement): string | undefined {
  if (element.id) {
    try {
      const byFor = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
      const text = textOrNull(byFor);
      if (text) return text;
    } catch {
      /* CSS.escape unavailable or invalid id */
    }
  }

  const wrapperLabel = element.closest('label');
  if (wrapperLabel) {
    const clone = wrapperLabel.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('input, textarea, select, button').forEach((el) => el.remove());
    const text = clone.textContent?.trim();
    if (text) return text;
  }

  return getLabelledByText(element);
}

export function getSurroundingText(element: Element, maxDepth = 3, maxLength = 300): string | undefined {
  const texts: string[] = [];
  let current: Element | null = element.parentElement;
  let depth = 0;
  while (current && depth < maxDepth) {
    const text = current.textContent?.trim();
    if (text && text.length > 2 && text.length < maxLength && !texts.includes(text)) {
      texts.push(text);
    }
    if (texts.join(' ').length > maxLength) break;
    current = current.parentElement;
    depth++;
  }
  const joined = texts.join(' | ');
  return joined.length > 0 ? joined.slice(0, maxLength) : undefined;
}

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6, [role="heading"]';

export function getSectionHeading(element: Element): string | undefined {
  let current: Element | null = element.parentElement;
  let depth = 0;
  while (current && depth < 8) {
    if (current.tagName === 'SECTION' || current.tagName === 'FIELDSET') {
      const legend = current.querySelector('legend');
      const legendText = textOrNull(legend);
      if (legendText) return legendText;
      const heading = current.querySelector(HEADING_SELECTOR);
      const headingText = textOrNull(heading);
      if (headingText) return headingText;
    }
    const ownHeading = current.matches?.(HEADING_SELECTOR)
      ? textOrNull(current)
      : textOrNull(current.querySelector(':scope > ' + HEADING_SELECTOR.split(', ').join(', :scope > ')));
    if (ownHeading && ownHeading.length < 80) return ownHeading;

    current = current.parentElement;
    depth++;
  }
  return undefined;
}

function extractOptions(element: Element): string[] | undefined {
  if (element instanceof HTMLSelectElement) {
    return Array.from(element.options)
      .map((opt) => opt.textContent?.trim() ?? '')
      .filter((t) => t.length > 0);
  }

  const role = element.getAttribute('role');
  if (role === 'listbox' || role === 'combobox') {
    const listId = element.getAttribute('aria-controls') ?? element.getAttribute('aria-owns');
    const list = listId ? document.getElementById(listId) : element.querySelector('[role="option"], option');
    if (list) {
      const options = Array.from(list.querySelectorAll('[role="option"], option'))
        .map((o) => o.textContent?.trim() ?? '')
        .filter((t) => t.length > 0);
      if (options.length > 0) return options;
    }
  }
  return undefined;
}

function getRawMetadata(element: Element): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  for (const attr of Array.from(element.attributes)) {
    if (attr.name.startsWith('data-') || attr.name.startsWith('aria-')) {
      metadata[attr.name] = attr.value;
    }
  }
  metadata.tagName = element.tagName;
  if (typeof element.className === 'string' && element.className) {
    metadata.className = element.className;
  }
  return metadata;
}

function resolveType(element: Element): string {
  if (element instanceof HTMLInputElement) return element.type || 'text';
  if (element instanceof HTMLTextAreaElement) return 'textarea';
  if (element instanceof HTMLSelectElement) return 'select';
  const role = element.getAttribute('role');
  if (role) return `role-${role}`;
  if (element.getAttribute('contenteditable') === 'true') return 'contenteditable';
  return element.tagName.toLowerCase();
}

export function extractSignals(element: Element): FieldSignals {
  const htmlEl = element as HTMLElement;
  const label = getAssociatedLabel(htmlEl);

  return {
    label,
    placeholder: element.getAttribute('placeholder')?.trim() || undefined,
    name: element.getAttribute('name')?.trim() || undefined,
    type: resolveType(element),
    role: element.getAttribute('role')?.trim() || undefined,
    autocomplete: element.getAttribute('autocomplete')?.trim() || undefined,
    ariaLabel: element.getAttribute('aria-label')?.trim() || undefined,
    description: getAriaDescription(element),
    surroundingText: getSurroundingText(element),
    options: extractOptions(element),
    required:
      element.hasAttribute('required') || element.getAttribute('aria-required') === 'true',
    disabled:
      element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true',
    section: getSectionHeading(element),
    rawMetadata: getRawMetadata(element),
  };
}