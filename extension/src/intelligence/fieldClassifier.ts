import type { SemanticField, FieldCategory } from '@schemas/dom';
import {
  SYNONYMS,
  normalizeText,
  categoryForKey,
} from './taxonomy';
import { isClassifiable } from './confidence';

export type MatchMethod =
  | 'autocomplete'
  | 'exact_synonym'
  | 'phrase_contained'
  | 'heuristic'
  | 'type_context'
  | 'section_context'
  | 'ai'
  | 'cache'
  | 'none';

export interface Classification {
  semanticField: string;
  category: FieldCategory;
  confidence: number;
  method: MatchMethod;
  reason: string;
}

const AUTOCOMPLETE_MAP: Record<string, { field: string; confidence: number }> = {
  email: { field: 'email', confidence: 0.99 },
  'email-address': { field: 'email', confidence: 0.99 },
  tel: { field: 'phone', confidence: 0.99 },
  'tel-national': { field: 'phone', confidence: 0.99 },
  name: { field: 'full_name', confidence: 0.98 },
  'given-name': { field: 'first_name', confidence: 0.99 },
  'additional-name': { field: 'middle_name', confidence: 0.99 },
  'family-name': { field: 'last_name', confidence: 0.99 },
  'organization': { field: 'current_company', confidence: 0.9 },
  'organization-title': { field: 'current_title', confidence: 0.9 },
  'address-line1': { field: 'address', confidence: 0.95 },
  'address-level2': { field: 'city', confidence: 0.95 },
  'address-level1': { field: 'state', confidence: 0.95 },
  country: { field: 'country', confidence: 0.95 },
  'postal-code': { field: 'zip_code', confidence: 0.95 },
  'bday': { field: 'date_of_birth', confidence: 0.95 },
};

interface HeuristicRule {
  field: string;
  pattern: RegExp;
  confidence: number;
  reason: string;
  labelOnly?: boolean;
}

const HEURISTIC_RULES: HeuristicRule[] = [
  { field: 'github', pattern: /github\.com|github\s+username|where can (we|i)\b.*\bcode|see your code|find your code|code repository|\bcode samples?\b/i, confidence: 0.88, reason: 'code-hosting phrasing points at GitHub' },
  { field: 'linkedin', pattern: /linkedin/i, confidence: 0.9, reason: 'mentions linkedin' },
  { field: 'years_experience', pattern: /years?[\s-]*(of[\s-]*)?([a-z]+\s+)?experience|how many years have you worked|years have you worked professionally|total years of (work|professional)/i, confidence: 0.9, reason: 'asks about years worked' },
  { field: 'salary_expectation', pattern: /(salary|compensation|expected\s*(ctc|pay|payroll)|desired\s*(salary|pay)|(annual|yearly)\s*(salary|compensation))|how much (do you )?(expect|want) (to be )?paid/i, confidence: 0.92, reason: 'asks about compensation' },
  { field: 'notice_period', pattern: /notice\s*period|how much notice|serving.*notice/i, confidence: 0.92, reason: 'asks about notice period' },
  { field: 'availability', pattern: /\b(earliest\s+(start|available)|when can you start|available\s+(to|from|by)|start\s+date|join(ing)?\s+date|how soon can you start|immediate[ly]?\s+join)\b/i, confidence: 0.8, reason: 'asks about availability/start date' },
  { field: 'requires_sponsorship', pattern: /sponsor(ship)?|require(s)?\s+(a\s+)?visa|visa\s+(required|needed|sponsorship)|need\s+(a\s+)?visa/i, confidence: 0.93, reason: 'asks about visa sponsorship' },
  { field: 'authorized_to_work', pattern: /authori[sz](ed|ation)|legally\s+(allowed|able|permitted)\s+to\s+work|eligible\s+to\s+work|right\s+to\s+work|permission\s+to\s+work|work\s+authori[sz]ation/i, confidence: 0.93, reason: 'asks about work authorization' },
  { field: 'why_role', pattern: /why[\s\S]{0,80}(this\s+(role|position|job)|interested\s+in\s+this\s+(role|position|job))|why\s+this\s+(role|position|job)/i, confidence: 0.85, reason: 'motivation for the role' },
  { field: 'why_company', pattern: /why[\s\S]{0,80}(want\s+to\s+work|join\s+(us|the\s+team)|this\s+company|our\s+company|company|organization|\bhere\b)/i, confidence: 0.85, reason: 'motivation for the company' },
  { field: 'why_you', pattern: /why\s+should\s+we\s+hire|tell\s+(us|me)\s+about\s+(yourself|you)\b|pitch\s+yourself|what\s+makes\s+you\s+a\s+(great|good)\s+fit/i, confidence: 0.87, reason: 'open self-introduction question' },
  { field: 'career_goals', pattern: /career\s+goals?|professional\s+goals?|where\s+do\s+you\s+see\s+yourself/i, confidence: 0.9, reason: 'asks about career goals' },
  { field: 'relocation', pattern: /relocat(e|ion)|willing\s+to\s+(move|relocate)/i, confidence: 0.9, reason: 'asks about relocation' },
  { field: 'remote_preference', pattern: /\bremote\b|work\s+from\s+home|hybrid\s+(role|work|setup)?/i, confidence: 0.75, reason: 'mentions remote/hybrid preference' },
  { field: 'referral_source', pattern: /how\s+did\s+you\s+hear|how\s+did\s+you\s+find|where\s+did\s+you\s+find\s+this/i, confidence: 0.9, reason: 'asks for sourcing channel' },
  { field: 'graduation_year', pattern: /graduat(e|ion)\s+(year|date)|year\s+of\s+graduation|expected\s+graduation|completion\s+year/i, confidence: 0.9, reason: 'asks for graduation timing' },
  { field: 'field_of_study', pattern: /field\s+of\s+study|\bmajor\b|speciali[sz]ation|discipline/i, confidence: 0.85, reason: 'asks for study field/major' },
  { field: 'gpa', pattern: /\bgpa\b|cgpa|cumulative\s+grade/i, confidence: 0.95, reason: 'asks for GPA' },
  { field: 'university', pattern: /(university|college|institute|school|alma\s+mater)(\s+(name|attended))?\b/i, confidence: 0.8, reason: 'asks for education institution' },
  { field: 'degree', pattern: /\bdegree\b|highest\s+qualification|degree\s+type/i, confidence: 0.85, reason: 'asks for degree' },
  { field: 'current_title', pattern: /current\s+(title|role|position|job)|your\s+(job\s+)?title|most\s+recent\s+(title|role|position)/i, confidence: 0.88, reason: 'asks for current role' },
  { field: 'current_company', pattern: /current\s+(company|employer)|present\s+(company|employer)|name\s+of\s+(your\s+)?(employer|company)|which\s+company/i, confidence: 0.88, reason: 'asks for current employer' },
  { field: 'portfolio', pattern: /\bportfolio\b|personal\s+website|personal\s+site|your\s+website|online\s+portfolio/i, confidence: 0.85, reason: 'asks for portfolio' },
  { field: 'terms_acceptance', pattern: /i\s+(certify|agree|acknowledge|confirm)\b|terms\s+(of\s+service|and\s+conditions|of\s+use)|privacy\s+policy/i, confidence: 0.9, reason: 'legal acceptance statement' },
  { field: 'pronouns', pattern: /pronoun/i, confidence: 0.95, reason: 'asks for pronouns' },
  { field: 'country', pattern: /\bcountry\b|\bnation\b/i, confidence: 0.9, reason: 'asks for country', labelOnly: true },
];

interface SynonymIndexEntry {
  key: string;
  synonym: string;
}

function buildSynonymIndex(): SynonymIndexEntry[] {
  const entries: SynonymIndexEntry[] = [];
  for (const [key, list] of Object.entries(SYNONYMS)) {
    for (const synonym of list) {
      entries.push({ key, synonym: normalizeText(synonym) });
    }
  }
  entries.sort((a, b) => b.synonym.length - a.synonym.length);
  return entries;
}

const SYNONYM_INDEX = buildSynonymIndex();

const UNKNOWN: Classification = {
  semanticField: 'unknown',
  category: 'unknown',
  confidence: 0,
  method: 'none',
  reason: 'no deterministic match',
};

function classifyByAutocomplete(field: SemanticField): Classification | null {
  const raw = field.autocomplete?.split(/\s+/)[0];
  if (!raw || raw === 'off' || raw === 'on' || raw === 'one-time-code') return null;
  const mapped = AUTOCOMPLETE_MAP[raw];
  if (!mapped) return null;
  return {
    semanticField: mapped.field,
    category: categoryForKey(mapped.field),
    confidence: mapped.confidence,
    method: 'autocomplete',
    reason: `autocomplete="${field.autocomplete}"`,
  };
}

function classifyByTypeContext(field: SemanticField): Classification | null {
  const text = normalizeText(
    [field.label, field.placeholder, field.section, field.ariaLabel].filter(Boolean).join(' ')
  );

  if (field.type === 'file') {
    if (/resume|cv/.test(text)) {
      return {
        semanticField: 'resume',
        category: 'file_upload',
        confidence: 0.97,
        method: 'type_context',
        reason: 'file input labelled as resume/CV',
      };
    }
    if (/cover\s*letter/.test(text)) {
      return {
        semanticField: 'cover_letter_file',
        category: 'file_upload',
        confidence: 0.97,
        method: 'type_context',
        reason: 'file input labelled as cover letter',
      };
    }
    return null;
  }

  if (field.type === 'url' || field.type === 'text') {
    if (/github/.test(text)) return withField('github', 0.95, 'type_context', 'url/text input mentions github');
    if (/linkedin/.test(text)) return withField('linkedin', 0.95, 'type_context', 'url/text input mentions linkedin');
    if (/portfolio|website|homepage/.test(text)) {
      return withField('portfolio', 0.9, 'type_context', 'url input labelled portfolio/website');
    }
  }

  if (field.type === 'email' && text.includes('email')) {
    return withField('email', 0.98, 'type_context', 'input type=email');
  }
  if (field.type === 'tel') {
    return withField('phone', 0.97, 'type_context', 'input type=tel');
  }

  return null;
}

function withField(
  field: string,
  confidence: number,
  method: MatchMethod,
  reason: string
): Classification {
  return {
    semanticField: field,
    category: categoryForKey(field),
    confidence,
    method,
    reason,
  };
}

function words(text: string): Set<string> {
  return new Set(text.split(' ').filter((w) => w.length > 1));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const w of a) if (b.has(w)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function classifyBySynonyms(
  source: 'label' | 'name' | 'placeholder' | 'surrounding',
  text: string
): Classification | null {
  const normalized = normalizeText(text);
  if (normalized.length === 0) return null;

  const sourcePenalty = source === 'label' ? 0 : source === 'surrounding' ? 0.12 : 0.06;
  let bestIdx = -1;
  let bestEntry: SynonymIndexEntry | null = null;

  for (const entry of SYNONYM_INDEX) {
    if (entry.synonym.length < 3) continue;

    if (normalized === entry.synonym) {
      return withField(entry.key, clamp(0.96 - sourcePenalty), 'exact_synonym', `${source} exactly matches "${entry.synonym}"`);
    }
  }

  for (const entry of SYNONYM_INDEX) {
    if (entry.synonym.length < 4) continue;
    const idx = indexOfPhrase(normalized, entry.synonym);
    if (idx === -1) continue;
    if (bestIdx === -1 || idx < bestIdx) {
      bestIdx = idx;
      bestEntry = entry;
    }
  }
  if (bestEntry) {
    return withField(bestEntry.key, clamp(0.9 - sourcePenalty), 'phrase_contained', `${source} contains "${bestEntry.synonym}"`);
  }

  const labelWords = words(normalized);
  let best: { key: string; score: number; synonym: string } | null = null;
  for (const entry of SYNONYM_INDEX) {
    if (entry.synonym.split(' ').length < 2) continue;
    const score = jaccard(labelWords, words(entry.synonym));
    if (score >= 0.6 && (!best || score > best.score)) {
      best = { key: entry.key, score, synonym: entry.synonym };
    }
  }
  if (best) {
    return withField(best.key, clamp(0.72 + (best.score - 0.6) * 0.4 - sourcePenalty), 'phrase_contained', `${source} overlaps "${best.synonym}"`);
  }

  return null;
}

function indexOfPhrase(text: string, phrase: string): number {
  const idx = text.indexOf(phrase);
  if (idx === -1) return -1;
  const before = idx === 0 ? ' ' : text[idx - 1];
  const afterIdx = idx + phrase.length;
  const after = afterIdx >= text.length ? ' ' : text[afterIdx];
  return /\s/.test(before) && /\s/.test(after) ? idx : -1;
}

function clamp(value: number): number {
  return Math.min(0.94, Math.max(0.5, Math.round(value * 100) / 100));
}

function primaryText(field: SemanticField): string {
  return [field.label, field.placeholder, field.ariaLabel, field.description]
    .filter(Boolean)
    .join(' ');
}

function labelishText(field: SemanticField): string {
  return [field.label, field.ariaLabel, field.description].filter(Boolean).join(' ');
}

function classifyByPrimaryHeuristics(field: SemanticField): Classification | null {
  const fullText = primaryText(field);
  const labelText = labelishText(field);
  if (!fullText && !labelText) return null;
  for (const rule of HEURISTIC_RULES) {
    const text = rule.labelOnly ? labelText : fullText;
    if (text && rule.pattern.test(text)) {
      return withField(rule.field, rule.confidence, 'heuristic', rule.reason);
    }
  }
  return null;
}

function classifyBySurroundingHeuristics(field: SemanticField): Classification | null {
  const text = primaryText(field);
  if (text && text.length >= 12) return null;
  const context = [text, field.surroundingText].filter(Boolean).join(' ');
  if (!context) return null;
  for (const rule of HEURISTIC_RULES) {
    if (rule.labelOnly) continue;
    if (rule.pattern.test(context)) {
      return withField(rule.field, rule.confidence - 0.05, 'heuristic', `${rule.reason} (via surrounding text)`);
    }
  }
  return null;
}

function classifyBySectionContext(field: SemanticField): Classification | null {
  const section = normalizeText(field.section ?? '');
  if (!section) return null;

  if (section.includes('compensation') || section.includes('salary')) {
    if (field.type === 'text' || field.type === 'number') {
      return withField('salary_expectation', 0.65, 'section_context', 'inside salary/compensation section');
    }
  }
  if (section.includes('links') || section.includes('profiles') || section.includes('social')) {
    if (field.type === 'url') {
      return withField('portfolio', 0.6, 'section_context', 'url inside links section');
    }
  }
  return null;
}

const TIER2_MIN_CONFIDENCE = 0.85;

export function classifyField(field: SemanticField): Classification {
  const primaryStrategies: Array<() => Classification | null> = [
    () => classifyByTypeContext(field),
    () => classifyByAutocomplete(field),
    () => (field.label ? classifyBySynonyms('label', field.label) : null),
    () =>
      field.ariaLabel && field.ariaLabel !== field.label
        ? classifyBySynonyms('label', field.ariaLabel)
        : null,
    () => classifyByPrimaryHeuristics(field),
    () => (field.name ? classifyBySynonyms('name', field.name) : null),
    () => (field.placeholder ? classifyBySynonyms('placeholder', field.placeholder) : null),
  ];

  let best = runStrategies(primaryStrategies);
  if (best && best.confidence >= TIER2_MIN_CONFIDENCE) return best;

  const contextStrategies: Array<() => Classification | null> = [
    () => classifyBySurroundingHeuristics(field),
    () =>
      field.surroundingText && !field.label && !field.placeholder && !field.ariaLabel && !field.description
        ? classifyBySynonyms('surrounding', field.surroundingText)
        : null,
    () => classifyBySectionContext(field),
  ];

  const contextBest = runStrategies(contextStrategies);
  if (contextBest && (!best || contextBest.confidence > best.confidence)) {
    best = contextBest;
  }

  if (!best || !isClassifiable(best.confidence)) return UNKNOWN;
  return best;
}

function runStrategies(strategies: Array<() => Classification | null>): Classification | null {
  let best: Classification | null = null;
  for (const strategy of strategies) {
    const result = strategy();
    if (result && (!best || result.confidence > best.confidence)) {
      best = result;
    }
  }
  return best;
}

export function classifyFields(fields: SemanticField[]): Map<string, Classification> {
  const results = new Map<string, Classification>();
  for (const field of fields) {
    results.set(field.id, classifyField(field));
  }
  return results;
}