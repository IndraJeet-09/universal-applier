import type { SemanticField, FormSection, FormAnalysis } from '@schemas/dom';
import { computeFingerprint } from '@schemas/dom';
import { registerHandlers } from '../utils/messaging';
import { createLogger } from '../utils/logger';

const log = createLogger('content');

const FIELD_SELECTORS = [
  'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"])',
  'textarea',
  'select',
  'button[type="button"]',
  '[role="textbox"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="radio"]',
  '[role="checkbox"]',
  '[contenteditable="true"]',
];

const SKIP_TYPES = ['hidden', 'submit', 'button', 'reset', 'image'];

function isVisible(element: Element): boolean {
  const style = getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function getAssociatedLabel(element: HTMLElement): string | null {
  if (element.id) {
    const label = document.querySelector(`label[for="${element.id}"]`);
    if (label) return label.textContent?.trim() || null;
  }
  const parentLabel = element.closest('label');
  if (parentLabel) {
    const clone = parentLabel.cloneNode(true) as HTMLElement;
    const inputs = clone.querySelectorAll('input, textarea, select');
    inputs.forEach(el => el.remove());
    return clone.textContent?.trim() || null;
  }
  const ariaLabelledBy = element.getAttribute('aria-labelledby');
  if (ariaLabelledBy) {
    const labelledElement = document.getElementById(ariaLabelledBy);
    if (labelledElement) return labelledElement.textContent?.trim() || null;
  }
  return null;
}

function getSurroundingText(element: Element, maxLength = 200): string {
  const texts: string[] = [];
  let current: Element | null = element.parentElement;
  let depth = 0;
  while (current && depth < 3) {
    const text = current.textContent?.trim();
    if (text && text.length > 2 && text.length < maxLength) {
      texts.push(text);
    }
    current = current.parentElement;
    depth++;
  }
  return texts.join(' | ').slice(0, maxLength);
}
function getSectionHeading(element: Element): string | null {
  let current: Element | null = element.parentElement;
  while (current) {
    const heading = current.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]');
    if (heading && heading !== element) {
      return heading.textContent?.trim() || null;
    }
    if (current.tagName === 'SECTION' || current.tagName === 'FIELDSET') {
      const legend = current.querySelector('legend');
      if (legend) return legend.textContent?.trim() || null;
    }
    current = current.parentElement;
  }
  return null;
}

function extractOptions(element: HTMLSelectElement): string[] {
  return Array.from(element.options).map(opt => opt.textContent?.trim() || '').filter(Boolean);
}

function getElementType(element: Element): string {
  const tag = element.tagName.toLowerCase();
  if (tag === 'input') {
    return (element as HTMLInputElement).type || 'text';
  }
  if (tag === 'textarea') return 'textarea';
  if (tag === 'select') return 'select';
  if (element.getAttribute('role')) return `role-${element.getAttribute('role')}`;
  if (element.getAttribute('contenteditable') === 'true') return 'contenteditable';
  return tag;
}

function getRawMetadata(element: Element): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  const attrs = element.attributes;
  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs[i];
    if (attr.name.startsWith('data-') || attr.name.startsWith('aria-')) {
      metadata[attr.name] = attr.value;
    }
  }
  metadata.tagName = element.tagName;
  metadata.className = element.className;
  return metadata;
}

export function scanDOM(): SemanticField[] {
  const fields: SemanticField[] = [];
  const seenElements = new WeakSet<Element>();

  for (const selector of FIELD_SELECTORS) {
    const elements = document.querySelectorAll(selector);
    for (const element of elements) {
      if (seenElements.has(element)) continue;
      seenElements.add(element);

      const htmlElement = element as HTMLElement;
      if (!isVisible(htmlElement)) continue;

      const inputElement = element as HTMLInputElement;
      if (SKIP_TYPES.includes(inputElement.type || '')) continue;

      const label: string | undefined =
        getAssociatedLabel(htmlElement) ?? htmlElement.getAttribute('aria-label') ?? undefined;
      const placeholder = htmlElement.getAttribute('placeholder') || undefined;
      const name = htmlElement.getAttribute('name') || undefined;
      const type = getElementType(element);
      const role = htmlElement.getAttribute('role') || undefined;
      const ariaLabel = htmlElement.getAttribute('aria-label') || undefined;
      const ariaDescribedBy = htmlElement.getAttribute('aria-describedby') || undefined;
      let description: string | undefined;
      if (ariaDescribedBy) {
        const descEl = document.getElementById(ariaDescribedBy);
        if (descEl) description = descEl.textContent?.trim();
      }
      const required = htmlElement.hasAttribute('required') || htmlElement.getAttribute('aria-required') === 'true';
      const disabled = htmlElement.hasAttribute('disabled') || htmlElement.getAttribute('aria-disabled') === 'true';
      const options = (element as HTMLSelectElement).options ? extractOptions(element as HTMLSelectElement) : undefined;
      const surroundingText = getSurroundingText(element);
      const section = getSectionHeading(element) ?? undefined;

      const field: SemanticField = {
        id: `field-${crypto.randomUUID()}`,
        selector: getSelector(element),
        elementType: getElementType(element),
        label,
        placeholder,
        name,
        type,
        role,
        ariaLabel,
        description,
        surroundingText,
        options,
        required,
        visible: true,
        disabled,
        section,
        rawMetadata: getRawMetadata(element),
        fingerprint: '',
      };

      field.fingerprint = computeFingerprint(field);
      fields.push(field);
    }
  }

  return fields;
}

function getSelector(element: Element): string {
  if (element.id) return `#${element.id}`;
  const path: string[] = [];
  let current: Element | null = element;
  while (current && current !== document.body) {
    const node: Element = current;
    let selector = node.tagName.toLowerCase();
    if (node.id) {
      selector += `#${node.id}`;
      path.unshift(selector);
      break;
    }
    if (node.className) {
      const classes = node.className.split(' ').filter(c => c && !c.startsWith('_')).slice(0, 2);
      if (classes.length > 0) {
        selector += `.${classes.join('.')}`;
      }
    }
    const parent: Element | null = node.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(el => el.tagName === node.tagName);
      if (siblings.length > 1) {
        const index = siblings.indexOf(node) + 1;
        selector += `:nth-of-type(${index})`;
      }
    }
    path.unshift(selector);
    current = parent;
  }
  return path.join(' > ');
}

export function scanShadowDOM(root: Document | ShadowRoot = document): SemanticField[] {
  const fields: SemanticField[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode()) {
    const element = walker.currentNode as HTMLElement;
    if (element.shadowRoot) {
      fields.push(...scanShadowDOM(element.shadowRoot));
    }
  }
  return fields;
}

export function getAllFields(): SemanticField[] {
  const domFields = scanDOM();
  const shadowFields = scanShadowDOM();
  return [...domFields, ...shadowFields];
}

export function analyzeForm(): FormAnalysis {
  const fields = getAllFields();
  const sections = groupFieldsBySection(fields);
  const totalFields = fields.length;
  const fillableFields = fields.filter(f => !f.disabled && f.visible).length;

  return {
    url: window.location.href,
    timestamp: new Date().toISOString(),
    formType: detectFormType(fields),
    isJobApplication: isJobApplication(fields),
    sections,
    totalFields,
    fillableFields,
    highConfidenceFields: 0,
    needsReviewFields: 0,
    fingerprint: computeFormFingerprint(fields),
  };
}

function groupFieldsBySection(fields: SemanticField[]): FormSection[] {
  const sectionMap = new Map<string, SemanticField[]>();
  for (const field of fields) {
    const sectionKey = field.section || 'general';
    if (!sectionMap.has(sectionKey)) {
      sectionMap.set(sectionKey, []);
    }
    sectionMap.get(sectionKey)!.push(field);
  }
  return Array.from(sectionMap.entries()).map(([name, fields]) => ({
    id: `section-${name}`,
    name,
    heading: name !== 'general' ? name : undefined,
    fields,
  }));
}

function detectFormType(fields: SemanticField[]): FormAnalysis['formType'] {
  const labels = fields.map(f => (f.label || f.placeholder || f.name || '').toLowerCase()).join(' ');
  if (labels.includes('password') && labels.includes('email')) return 'login';
  if (labels.includes('signup') || labels.includes('register') || labels.includes('create account')) return 'signup';
  if (labels.includes('contact') || labels.includes('message')) return 'contact';
  if (isJobApplication(fields)) return 'application';
  return 'unknown';
}

function isJobApplication(fields: SemanticField[]): boolean {
  const text = fields.map(f => (f.label || f.placeholder || f.name || f.surroundingText || '').toLowerCase()).join(' ');
  const jobKeywords = [
    'resume', 'cv', 'cover letter', 'experience', 'education',
    'linkedin', 'github', 'portfolio', 'work authorization',
    'visa', 'sponsorship', 'salary', 'notice period',
    'years of experience', 'current role', 'previous employer',
  ];
  return jobKeywords.some(keyword => text.includes(keyword));
}

function computeFormFingerprint(fields: SemanticField[]): string {
  const sorted = fields.map(f => f.fingerprint).sort().join('|');
  let hash = 0;
  for (let i = 0; i < sorted.length; i++) {
    const char = sorted.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

let observer: MutationObserver | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function observeDOMChanges(callback: () => void): void {
  if (observer) observer.disconnect();
  observer = new MutationObserver((mutations) => {
    const relevant = mutations.some(m =>
      m.type === 'childList' && m.addedNodes.length > 0
    );
    if (relevant) {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(callback, 300);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

export function stopObserving(): void {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

registerHandlers({
  async 'content-ping'() {
    return { hasContentScript: true };
  },
  async 'scan-fields'() {
    return { fields: getAllFields() };
  },
  async 'analyze-form'() {
    return analyzeForm();
  },
});

log.info('content script loaded', { url: window.location.href });