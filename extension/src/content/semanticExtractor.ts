import type { SemanticField, FormSection, FormAnalysis, JobContext } from '@schemas/dom';
import { computeFingerprint } from '@schemas/dom';
import { queryInteractive } from './domScanner';
import { extractSignals } from './fieldExtractor';
import { collectRoots } from './rootCollector';
import {
  classifyPage,
  fieldsToSignals,
  type PageSignals,
} from '../intelligence/pageClassifier';
import { createLogger } from '../utils/logger';
import { cssEscape } from '../utils/dom';

const log = createLogger('semantic');

let fieldCounter = 0;

function toSemanticField(element: Element, selector: string): SemanticField {
  const signals = extractSignals(element);
  fieldCounter += 1;

  const field: SemanticField = {
    id: `f${fieldCounter}-${Date.now().toString(36)}`,
    selector,
    elementType: signals.type,
    label: signals.label,
    placeholder: signals.placeholder,
    name: signals.name,
    type: signals.type,
    role: signals.role,
    autocomplete: signals.autocomplete,
    ariaLabel: signals.ariaLabel,
    description: signals.description,
    surroundingText: signals.surroundingText,
    options: signals.options,
    required: signals.required,
    visible: true,
    disabled: signals.disabled,
    section: signals.section,
    rawMetadata: signals.rawMetadata,
    fingerprint: '',
  };
  field.fingerprint = computeFingerprint(field);
  return field;
}

export function buildSelector(element: Element): string {
  if (element.id) return `#${cssEscape(element.id)}`;
  const path: string[] = [];
  let current: Element | null = element;
  while (current && current !== document.body) {
    const node: Element = current;
    let selector = node.tagName.toLowerCase();
    if (node.id) {
      path.unshift(`${selector}#${node.id}`);
      break;
    }
    if (typeof node.className === 'string' && node.className) {
      const classes = node.className.split(/\s+/).filter((c) => c && !/^_/.test(c)).slice(0, 2);
      if (classes.length > 0) selector += `.${classes.join('.')}`;
    }
    const parent: Element | null = node.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter((el) => el.tagName === node.tagName);
      if (siblings.length > 1) {
        selector += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      }
    }
    path.unshift(selector);
    current = parent;
  }
  return path.join(' > ');
}

export function scanFields(): SemanticField[] {
  const fields: SemanticField[] = [];
  const seen = new WeakSet<Element>();

  for (const root of collectRoots()) {
    for (const element of queryInteractive(root)) {
      if (seen.has(element)) continue;
      seen.add(element);
      fields.push(toSemanticField(element, buildSelector(element)));
    }
  }

  log.debug('scan complete', { fieldCount: fields.length });
  return fields;
}

const JOB_KEYWORDS = [
  'resume', 'cv', 'cover letter', 'work experience', 'years of experience',
  'education', 'linkedin', 'github', 'portfolio', 'work authorization',
  'visa', 'sponsorship', 'salary', 'notice period', 'expected ctc',
  'current employer', 'how did you hear', 'referral', 'earliest start date',
  'university', 'college', 'degree',
];

const APPLY_SIGNALS = [
  'apply now', 'apply for', 'apply to', 'start application', 'submit application',
  'quick apply', 'apply for this job', 'apply for this position',
];

const FORM_KEYWORDS: Record<string, string[]> = {
  login: ['password', 'sign in', 'log in', 'forgot password'],
  signup: ['create account', 'sign up', 'confirm password'],
  contact: ['message', 'subject', 'send message', 'contact us'],
};

export interface JobPageContext {
  title?: string;
  company?: string;
  location?: string;
  employmentType?: string;
}

export function visiblePageText(): string {
  if (typeof document.body?.innerText === 'string') return document.body.innerText;
  return document.body?.textContent ?? '';
}

export function extractPageText(maxChars = 20000): string {
  return visiblePageText().slice(0, maxChars);
}

function collectTexts(selector: string, max: number): string[] {
  try {
    const nodes = Array.from(document.querySelectorAll(selector));
    return nodes
      .map((el) => {
        const direct = (el as HTMLElement).innerText;
        const value = typeof direct === 'string' && direct.trim().length > 0 ? direct : (el.textContent ?? '');
        return value.replace(/\s+/g, ' ').trim();
      })
      .filter((t) => t.length > 0 && t.length <= 140)
      .slice(0, max);
  } catch {
    return [];
  }
}

/** Compact page-level signals — never the whole DOM — for the page classifier. */
export function collectPageSignals(fields: SemanticField[], text: string): PageSignals {
  return {
    url: window.location.href,
    title: document.title ?? '',
    headings: collectTexts('h1, h2, [role="heading"]', 12),
    text,
    controls: collectTexts(
      'button, [role="button"], input[type="submit"], input[type="button"], a',
      40
    ),
    fields: fieldsToSignals(fields),
  };
}

export function detectJobContext(text: string): JobContext | undefined {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const context: JobContext = {};

  const h1 = document.querySelector('h1');
  const h1Text = h1?.textContent?.trim();
  if (h1Text && h1Text.length < 150) context.title = h1Text;

  const titleMeta =
    document.querySelector('meta[property="og:title"]')?.getAttribute('content') ??
    document.title;
  if (!context.title && titleMeta) context.title = titleMeta.split(/\s+[|·—-]\s+/)[0];

  const applyLine = lines.find((l) => /apply|opening|job opening|position/i.test(l) && l.length < 120);
  const companyMeta =
    document.querySelector('meta[property="og:site_name"]')?.getAttribute('content') ??
    document.querySelector('meta[name="company"]')?.getAttribute('content');
  if (companyMeta) context.company = companyMeta;
  if (!context.company && applyLine) {
    const m = applyLine.match(/at\s+([A-Z][\w&.,' -]{2,60})/);
    if (m) context.company = m[1].trim();
  }

  const employment = text.match(/\b(full[- ]time|part[- ]time|contract|internship|temporary)\b/i);
  if (employment) context.employmentType = employment[0];

  const locationLine = lines.find(
    (l) =>
      l.length < 80 &&
      /^[A-Za-z .'-]+,\s*[A-Z]{2}$/.test(l) ||
      /^\s*(remote|hybrid|on-?site)\s*$/i.test(l)
  );
  if (locationLine) context.location = locationLine;

  if (!context.title && !context.company) return undefined;
  return context;
}

export function classifyForm(fields: SemanticField[]): FormAnalysis['formType'] {
  const haystack = fields
    .map((f) => [f.label, f.placeholder, f.name, f.section, f.ariaLabel].filter(Boolean).join(' '))
    .join(' ')
    .toLowerCase();

  if (!fields.some((f) => f.type !== 'submit' && f.type !== 'button')) return 'unknown';

  for (const [type, keywords] of Object.entries(FORM_KEYWORDS)) {
    const hits = keywords.filter((k) => haystack.includes(k)).length;
    if (hits >= 2) {
      return type as FormAnalysis['formType'];
    }
  }

  return isJobApplication(fields, haystack) ? 'application' : 'unknown';
}

function isJobApplication(fields: SemanticField[], haystack: string): boolean {
  const keywordHits = JOB_KEYWORDS.filter((k) => haystack.includes(k)).length;
  const pageText = visiblePageText().toLowerCase();
  const hasApplySignal = APPLY_SIGNALS.some((s) => pageText.includes(s));
  const hasFileInput = fields.some((f) => f.type === 'file');
  const hasIdentity =
    haystack.includes('email') && (haystack.includes('name') || haystack.includes('first name'));
  const pageSignal = /appl(?:y|ication)|career|job|hiring|join (our|the) team|open (role|position)/i.test(
    `${document.title} ${document.querySelector('h1')?.textContent ?? ''}`
  );

  if (keywordHits >= 2) return true;
  if (keywordHits >= 1 && hasFileInput) return true;
  if (keywordHits >= 1 && pageSignal && hasIdentity) return true;
  if (hasApplySignal && hasIdentity && keywordHits >= 1) return true;
  if (pageSignal && hasIdentity && fields.length >= 3) return true;
  return false;
}

export function groupIntoSections(fields: SemanticField[]): FormSection[] {
  const map = new Map<string, SemanticField[]>();
  for (const field of fields) {
    const key = field.section?.trim() || 'general';
    const list = map.get(key);
    if (list) list.push(field);
    else map.set(key, [field]);
  }
  return Array.from(map.entries()).map(([name, sectionFields], index) => ({
    id: `sec-${index}`,
    name,
    heading: name !== 'general' ? name : undefined,
    fields: sectionFields,
  }));
}

export function computeFormFingerprint(fields: SemanticField[]): string {
  const sorted = fields.map((f) => f.fingerprint).sort().join('|');
  let hash = 0;
  for (let i = 0; i < sorted.length; i++) {
    hash = (hash << 5) - hash + sorted.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function analyzeForm(): FormAnalysis {
  const fields = scanFields();
  const text = extractPageText();
  const formType = classifyForm(fields);
  const page = classifyPage(collectPageSignals(fields, text));
  const jobContext = formType === 'application' ? detectJobContext(text) : undefined;

  const analysis: FormAnalysis = {
    url: window.location.href,
    timestamp: new Date().toISOString(),
    formType,
    isJobApplication: formType === 'application',
    pageType: page.pageType,
    pageConfidence: page.confidence,
    pageReasons: page.reasons,
    jobContext,
    sections: groupIntoSections(fields),
    totalFields: fields.length,
    fillableFields: fields.filter((f) => !f.disabled).length,
    highConfidenceFields: 0,
    needsReviewFields: 0,
    fingerprint: computeFormFingerprint(fields),
  };

  log.info('form analyzed', {
    formType,
    pageType: page.pageType,
    pageConfidence: page.confidence,
    fields: analysis.totalFields,
    fingerprint: analysis.fingerprint,
  });

  return analysis;
}