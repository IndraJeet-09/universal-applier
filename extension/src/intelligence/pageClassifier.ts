import type { PageType, SemanticField } from '@schemas/dom';

export interface PageFieldSignal {
  label?: string;
  placeholder?: string;
  name?: string;
  type?: string;
  role?: string;
  section?: string;
  ariaLabel?: string;
}

export interface PageSignals {
  url: string;
  title: string;
  headings: string[];
  text: string;
  controls: string[];
  fields: PageFieldSignal[];
}

export interface PageClassification {
  pageType: PageType;
  confidence: number;
  reasons: string[];
}

const APPLICATION_PATTERNS: Array<[string, RegExp]> = [
  ['application', /\bapplications?\b|apply now|apply for|quick apply|easy apply|start application|submit application|\bapply\b/i],
  ['resume', /\bresume\b|\bcv\b/i],
  ['cover_letter', /cover letter/i],
  ['work_authorization', /work authori[sz]ation|authorized to work|right to work|eligible to work/i],
  ['visa', /\bvisa\b|sponsorship/i],
  ['candidate', /\bcandidates?\b|\bapplicants?\b/i],
  ['experience', /years? of experience|work experience|professional experience|design experience/i],
  ['education', /\beducation\b|\buniversity\b|\bcollege\b|\bdegree\b/i],
  ['compensation', /salary|compensation|notice period/i],
  ['hiring', /\bhiring\b|join (our|the) team|job opening|open (roles?|positions?)|career/i],
];

const AUTH_PATTERNS: RegExp[] = [
  /\bpassword\b/i,
  /\bsign in\b|\blog in\b|\bforgot (your )?password\b|\bcreate an account\b|\bcreate account\b/i,
];

const CONTACT_PATTERNS: RegExp[] = [
  /contact us|get in touch|send (us )?(a )?message|send message|reach out to us/i,
  /\bsubject\b/i,
  /\bmessage\b/i,
];

const STEP_PATTERN = /step\s*\d+\s*(of|\/|–|-)\s*\d+/i;
const JOB_POSTING_PATTERN =
  /responsibilities|what you('|’)ll do|about the (job|role|position)|requirements|qualifications|benefits|full-?time|part-?time/i;

const NOT_JOB_CONFIDENCE = 0.72;
const UNKNOWN_CONFIDENCE = 0.5;

function countHits(patterns: Array<[string, RegExp]>, text: string): { count: number; hits: string[] } {
  const hits: string[] = [];
  for (const [name, re] of patterns) {
    if (re.test(text)) hits.push(name);
  }
  return { count: hits.length, hits };
}

function anyHit(patterns: RegExp[], text: string): boolean {
  return patterns.some((re) => re.test(text));
}

export function fieldsToSignals(fields: SemanticField[]): PageFieldSignal[] {
  return fields.map((f) => ({
    label: f.label,
    placeholder: f.placeholder,
    name: f.name,
    type: f.type,
    role: f.role,
    section: f.section,
    ariaLabel: f.ariaLabel,
  }));
}

export function classifyPage(signals: PageSignals): PageClassification {
  const fieldHaystack = signals.fields
    .map((f) => [f.label, f.placeholder, f.name, f.section, f.ariaLabel].filter(Boolean).join(' '))
    .join(' ')
    .toLowerCase();

  const metaText = [signals.title, ...signals.headings].join(' ');
  const text = `${metaText}\n${signals.text.slice(0, 12000)}`.replace(/\s+/g, ' ');
  const haystack = `${text}\n${fieldHaystack}`;

  const controlText = signals.controls.join(' ');
  const hasApplyControl = /\bapply\b|start application|submit application|quick apply|easy apply/i.test(
    controlText
  );

  const fieldCount = signals.fields.length;
  const hasFileUpload = signals.fields.some((f) => f.type === 'file');
  const hasIdentity =
    signals.fields.some((f) => f.type === 'email') &&
    signals.fields.some((f) => /name/i.test(f.label ?? f.name ?? f.placeholder ?? ''));

  const application = countHits(APPLICATION_PATTERNS, haystack);
  const stepSignal =
    STEP_PATTERN.test(text) ||
    (/\bnext\b/i.test(controlText) && /\bback\b|\bprevious\b/i.test(controlText));
  const jobPostingText = JOB_POSTING_PATTERN.test(text);

  const jobEvidence = application.count + (hasApplyControl ? 1 : 0) + (hasFileUpload ? 1 : 0) +
    (hasIdentity && fieldCount >= 3 ? 1 : 0);

  const evidenceReasons = [
    `application signals: ${application.hits.join(', ') || 'none'}`,
    hasApplyControl ? 'apply control present' : '',
    hasFileUpload ? 'file upload present' : '',
    hasIdentity && fieldCount >= 3 ? 'identity fields present' : '',
  ].filter(Boolean);

  // 1. Authentication pages are never job application pages on their own.
  if (anyHit(AUTH_PATTERNS, haystack) && jobEvidence < 2) {
    return {
      pageType: 'NOT_JOB_PAGE',
      confidence: 0.9,
      reasons: ['password/sign-in signals without application evidence'],
    };
  }

  // 2. Plain contact forms must not be mistaken for job applications.
  const contactHits = CONTACT_PATTERNS.filter((re) => re.test(haystack)).length;
  if (contactHits >= 1 && jobEvidence < 2 && !hasApplyControl) {
    return {
      pageType: 'NOT_JOB_PAGE',
      confidence: 0.85,
      reasons: ['contact form signals', `contact hits: ${contactHits}`],
    };
  }

  if (jobEvidence >= 2) {
    if (stepSignal) {
      return { pageType: 'APPLICATION_STEP', confidence: 0.88, reasons: evidenceReasons };
    }
    if (fieldCount > 0) {
      return { pageType: 'APPLICATION_FORM', confidence: 0.9, reasons: evidenceReasons };
    }
    return {
      pageType: 'JOB_LISTING',
      confidence: 0.85,
      reasons: [...evidenceReasons, 'apply control without form fields'],
    };
  }

  // 3. Apply CTA plus job-posting copy but no form yet = the listing itself.
  if (hasApplyControl && fieldCount === 0 && (jobPostingText || application.count >= 1)) {
    return {
      pageType: 'JOB_LISTING',
      confidence: 0.8,
      reasons: ['apply control with job posting copy and no form fields'],
    };
  }

  // 4. Faint job signals: too little evidence to decide.
  if (application.count > 0 || jobPostingText || hasApplyControl) {
    return {
      pageType: 'UNKNOWN',
      confidence: UNKNOWN_CONFIDENCE,
      reasons: [`weak signals: ${application.hits.join(', ') || 'general job copy'}`],
    };
  }

  return {
    pageType: 'NOT_JOB_PAGE',
    confidence: NOT_JOB_CONFIDENCE,
    reasons: ['no job application signals'],
  };
}
