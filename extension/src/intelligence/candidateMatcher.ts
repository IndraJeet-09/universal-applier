import type { CandidateProfile, ApplicationAnswer } from '@schemas/candidate';
import { isSensitiveKey } from './taxonomy';

export type ValueSource = 'profile' | 'saved_answer' | 'none';

export interface MatchResult {
  semanticField: string;
  value: string | null;
  source: ValueSource;
  profilePath?: string;
  reason: string;
}

const UNKNOWN_RESULT = (field: string, reason: string): MatchResult => ({
  semanticField: field,
  value: null,
  source: 'none',
  reason,
});

function firstNonEmpty(...values: Array<string | undefined | null>): string | undefined {
  for (const v of values) {
    if (v !== undefined && v !== null && String(v).trim().length > 0) {
      return String(v).trim();
    }
  }
  return undefined;
}

function ok(field: string, value: string, path: string): MatchResult {
  return { semanticField: field, value, source: 'profile', profilePath: path, reason: `profile.${path}` };
}

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const w of a) if (b.has(w)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function findSavedAnswer(
  questionText: string,
  answers: ApplicationAnswer[],
  threshold = 0.4
): ApplicationAnswer | null {
  const target = tokens(questionText);
  if (target.size === 0) return null;

  let best: { answer: ApplicationAnswer; score: number } | null = null;
  for (const answer of answers) {
    const score = jaccard(target, tokens(answer.question));
    if (score >= threshold && (!best || score > best.score)) {
      best = { answer, score };
    }
  }
  return best?.answer ?? null;
}

function resolveFromSavedAnswers(field: string, profile: CandidateProfile, contextText: string): MatchResult | null {
  const answer = findSavedAnswer(contextText, profile.applicationAnswers);
  if (answer) {
    return {
      semanticField: field,
      value: answer.answer,
      source: 'saved_answer',
      reason: `saved answer: "${answer.question}"`,
    };
  }
  return null;
}

export function resolveValue(
  semanticField: string,
  profile: CandidateProfile,
  contextText = ''
): MatchResult {
  const saved = () => resolveFromSavedAnswers(semanticField, profile, contextText);
  const fallback = (reason: string): MatchResult => saved() ?? UNKNOWN_RESULT(semanticField, reason);

  if (isSensitiveKey(semanticField)) {
    const savedResult = resolveFromSavedAnswers(semanticField, profile, contextText);
    if (savedResult) return savedResult;
    const explicit = resolveExplicitSensitive(semanticField, profile);
    if (explicit) return explicit;
    return UNKNOWN_RESULT(semanticField, 'sensitive field without explicit candidate data');
  }

  switch (semanticField) {
    case 'full_name': {
      const v = firstNonEmpty(profile.personal.fullName);
      return v ? ok(semanticField, v, 'personal.fullName') : fallback('no name in profile');
    }
    case 'first_name': {
      const v = firstNonEmpty(
        profile.personal.firstName,
        profile.personal.fullName.split(' ')[0]
      );
      return v ? ok(semanticField, v, 'personal.firstName') : fallback('no first name');
    }
    case 'middle_name': {
      const v = firstNonEmpty(profile.personal.middleName);
      return v ? ok(semanticField, v, 'personal.middleName') : fallback('no middle name');
    }
    case 'last_name': {
      const parts = profile.personal.fullName.split(/\s+/);
      const v = firstNonEmpty(profile.personal.lastName, parts.length > 1 ? parts[parts.length - 1] : undefined);
      return v ? ok(semanticField, v, 'personal.lastName') : fallback('no last name');
    }
    case 'email': {
      const v = firstNonEmpty(profile.personal.email);
      return v ? ok(semanticField, v, 'personal.email') : fallback('no email in profile');
    }
    case 'phone': {
      const v = firstNonEmpty(profile.personal.phone);
      return v ? ok(semanticField, v, 'personal.phone') : fallback('no phone in profile');
    }
    case 'date_of_birth': {
      const v = firstNonEmpty(profile.personal.dateOfBirth);
      return v ? ok(semanticField, v, 'personal.dateOfBirth') : fallback('no date of birth');
    }
    case 'address': {
      const v = firstNonEmpty(profile.personal.address);
      return v ? ok(semanticField, v, 'personal.address') : fallback('no address');
    }
    case 'city': {
      const v = firstNonEmpty(profile.personal.city, profile.personal.location);
      return v ? ok(semanticField, v, 'personal.city') : fallback('no city');
    }
    case 'state': {
      const v = firstNonEmpty(profile.personal.state);
      return v ? ok(semanticField, v, 'personal.state') : fallback('no state');
    }
    case 'country': {
      const v = firstNonEmpty(profile.personal.country);
      return v ? ok(semanticField, v, 'personal.country') : fallback('no country');
    }
    case 'zip_code': {
      const v = firstNonEmpty(profile.personal.postalCode);
      return v ? ok(semanticField, v, 'personal.postalCode') : fallback('no postal code');
    }

    case 'current_title': {
      const v = firstNonEmpty(profile.professional.currentRole, profile.experience[0]?.title);
      return v ? ok(semanticField, v, 'professional.currentRole') : fallback('no current role');
    }
    case 'current_company': {
      const v = firstNonEmpty(profile.professional.currentCompany, profile.experience[0]?.company);
      return v ? ok(semanticField, v, 'professional.currentCompany') : fallback('no current company');
    }
    case 'years_experience': {
      const years = profile.professional.yearsOfExperience;
      if (typeof years === 'number') return ok(semanticField, String(years), 'professional.yearsOfExperience');
      return fallback('years of experience unknown');
    }
    case 'professional_summary': {
      const v = firstNonEmpty(profile.professional.summary, profile.professional.headline);
      return v ? ok(semanticField, v, 'professional.summary') : fallback('no summary');
    }
    case 'linkedin': {
      const v = firstNonEmpty(profile.links.linkedin);
      return v ? ok(semanticField, v, 'links.linkedin') : fallback('no linkedin in profile');
    }
    case 'github': {
      const v = firstNonEmpty(profile.links.github);
      return v ? ok(semanticField, v, 'links.github') : fallback('no github in profile');
    }
    case 'portfolio': {
      const v = firstNonEmpty(profile.links.portfolio, profile.links.website);
      return v ? ok(semanticField, v, 'links.portfolio') : fallback('no portfolio in profile');
    }

    case 'university': {
      const v = firstNonEmpty(profile.education[0]?.institution);
      return v ? ok(semanticField, v, 'education[0].institution') : fallback('no education');
    }
    case 'degree': {
      const v = firstNonEmpty(profile.education[0]?.degree);
      return v ? ok(semanticField, v, 'education[0].degree') : fallback('no degree');
    }
    case 'field_of_study': {
      const v = firstNonEmpty(profile.education[0]?.fieldOfStudy);
      return v ? ok(semanticField, v, 'education[0].fieldOfStudy') : fallback('no field of study');
    }
    case 'graduation_year': {
      const year = profile.education[0]?.graduationYear;
      return year ? ok(semanticField, String(year), 'education[0].graduationYear') : fallback('no graduation year');
    }
    case 'gpa': {
      const v = firstNonEmpty(profile.education[0]?.gpa);
      return v ? ok(semanticField, v, 'education[0].gpa') : fallback('no GPA');
    }

    case 'skills': {
      const all = [
        ...profile.skills.programmingLanguages,
        ...profile.skills.frameworks,
        ...profile.skills.databases,
        ...profile.skills.cloud,
        ...profile.skills.tools,
        ...profile.skills.other,
      ];
      return all.length > 0 ? ok(semanticField, all.join(', '), 'skills') : fallback('no skills');
    }
    case 'programming_languages': {
      const v = profile.skills.programmingLanguages;
      return v.length > 0 ? ok(semanticField, v.join(', '), 'skills.programmingLanguages') : fallback('no languages');
    }
    case 'frameworks': {
      const v = profile.skills.frameworks;
      return v.length > 0 ? ok(semanticField, v.join(', '), 'skills.frameworks') : fallback('no frameworks');
    }

    case 'cover_letter':
    case 'why_company':
    case 'why_role':
    case 'why_you':
    case 'career_goals':
    case 'referral_source':
    case 'availability':
    case 'employment_type':
      return fallback(`no stored answer for ${semanticField}`);

    case 'remote_preference': {
      const v = firstNonEmpty(profile.professional.remotePreference);
      if (v) return ok(semanticField, v, 'professional.remotePreference');
      return fallback('no remote preference');
    }
    case 'relocation': {
      const r = profile.professional.relocation;
      if (r === true) return ok(semanticField, 'Yes', 'professional.relocation');
      if (r === false) return ok(semanticField, 'No', 'professional.relocation');
      return fallback('relocation preference unknown');
    }

    case 'resume':
    case 'cover_letter_file':
      return saved() ?? UNKNOWN_RESULT(semanticField, 'file fields require configured resume file');

    default:
      return fallback(`unhandled semantic field ${semanticField}`);
  }
}

function resolveExplicitSensitive(field: string, profile: CandidateProfile): MatchResult | null {
  const auth = profile.workAuthorization;
  switch (field) {
    case 'authorized_to_work': {
      if (auth.authorizedToWork === true) return ok(field, 'Yes', 'workAuthorization.authorizedToWork');
      if (auth.authorizedToWork === false) return ok(field, 'No', 'workAuthorization.authorizedToWork');
      return null;
    }
    case 'requires_sponsorship': {
      if (auth.requiresSponsorship === true) return ok(field, 'Yes', 'workAuthorization.requiresSponsorship');
      if (auth.requiresSponsorship === false) return ok(field, 'No', 'workAuthorization.requiresSponsorship');
      return null;
    }
    case 'visa_status': {
      const v = firstNonEmpty(auth.visaStatus);
      return v ? ok(field, v, 'workAuthorization.visaStatus') : null;
    }
    case 'salary_expectation': {
      const s = profile.professional.salaryExpectation;
      if (!s) return null;
      if (s.min && s.max) return ok(field, `${s.min} - ${s.max} ${s.currency ?? ''}`.trim(), 'professional.salaryExpectation');
      if (s.min) return ok(field, String(s.min), 'professional.salaryExpectation.min');
      if (s.max) return ok(field, String(s.max), 'professional.salaryExpectation.max');
      return null;
    }
    case 'notice_period': {
      const v = firstNonEmpty(profile.professional.noticePeriod);
      return v ? ok(field, v, 'professional.noticePeriod') : null;
    }
    case 'relocation': {
      const r = profile.professional.relocation;
      if (r === true) return ok(field, 'Yes', 'professional.relocation');
      if (r === false) return ok(field, 'No', 'professional.relocation');
      return null;
    }
    case 'terms_acceptance':
    case 'gender':
    case 'ethnicity':
    case 'veteran_status':
    case 'disability_status':
    case 'pronouns':
      return null;
    default:
      return null;
  }
}

const YES_ALIASES = ['yes', 'y', 'true', '1', 'yeah', 'yep', 'absolutely', 'of course'];
const NO_ALIASES = ['no', 'n', 'false', '0', 'nope', 'not at all'];

export function matchOption(options: string[], desired: string): string | null {
  if (options.length === 0) return null;

  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const desiredNorm = normalize(desired);

  const exact = options.find((o) => normalize(o) === desiredNorm);
  if (exact) return exact;

  const desiredIsYes = YES_ALIASES.includes(desiredNorm);
  const desiredIsNo = NO_ALIASES.includes(desiredNorm);

  for (const option of options) {
    const optionNorm = normalize(option);
    if (desiredIsYes && (optionNorm === 'yes' || optionNorm === 'y' || optionNorm === 'true')) return option;
    if (desiredIsNo && (optionNorm === 'no' || optionNorm === 'n' || optionNorm === 'false')) return option;
  }

  const numeric = Number(desiredNorm);
  if (Number.isFinite(numeric) && /^\d+$/.test(desiredNorm)) {
    for (const option of options) {
      const range = option.match(/(\d+)\s*(?:-|–|—|to)\s*(\d+)/);
      if (range && numeric >= Number(range[1]) && numeric <= Number(range[2])) return option;
      const open = option.match(/(\d+)\s*\+/);
      if (open && numeric >= Number(open[1])) return option;
    }
  }

  if (desiredNorm.includes('bachelor') || desiredNorm.includes('undergrad')) {
    const match = options.find((o) => /bachelor|undergrad|b\.?tech|b\.?e\.?|b\.?s/i.test(o));
    if (match) return match;
  }
  if (desiredNorm.includes('master') || desiredNorm.includes('postgrad')) {
    const match = options.find((o) => /master|postgrad|m\.?tech|m\.?s|m\.?b\.?a/i.test(o));
    if (match) return match;
  }

  const tokensDesired = tokens(desired);
  let best: { option: string; score: number } | null = null;
  for (const option of options) {
    const score = jaccard(tokensDesired, tokens(option));
    if (score >= 0.5 && (!best || score > best.score)) best = { option, score };
  }
  if (best) return best.option;

  return null;
}