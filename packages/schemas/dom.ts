export interface SemanticField {
  id: string;
  selector: string;
  elementType: string;
  semanticName?: string;
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
  visible: boolean;
  disabled: boolean;
  section?: string;
  rawMetadata?: Record<string, unknown>;
  fingerprint: string;
  confidence?: number;
  matchedProfileField?: string;
  fillStatus?: 'pending' | 'filled' | 'failed' | 'skipped' | 'needs_review';
  fillValue?: string;
}

export interface FormSection {
  id: string;
  name?: string;
  heading?: string;
  fields: SemanticField[];
}

export type PageType =
  | 'NOT_JOB_PAGE'
  | 'JOB_LISTING'
  | 'APPLICATION_FORM'
  | 'APPLICATION_STEP'
  | 'UNKNOWN';

export interface FormAnalysis {
  url: string;
  timestamp: string;
  formType: 'application' | 'login' | 'signup' | 'contact' | 'unknown';
  isJobApplication: boolean;
  pageType?: PageType;
  pageConfidence?: number;
  pageReasons?: string[];
  jobContext?: JobContext;
  /** A CAPTCHA challenge is present — the user must solve it manually. */
  captchaDetected?: boolean;
  sections: FormSection[];
  totalFields: number;
  fillableFields: number;
  highConfidenceFields: number;
  needsReviewFields: number;
  fingerprint: string;
}

export interface JobContext {
  title?: string;
  company?: string;
  location?: string;
  description?: string;
  requirements?: string[];
  responsibilities?: string[];
  skills?: string[];
  employmentType?: string;
  experienceLevel?: string;
  salaryRange?: {
    min?: number;
    max?: number;
    currency?: string;
  };
}

export interface FieldClassification {
  fieldId: string;
  semanticField: string;
  category: FieldCategory;
  confidence: number;
  reason: string;
  method: 'deterministic' | 'synonym' | 'heuristic' | 'ai' | 'cache';
}

export type FieldCategory =
  | 'identity'
  | 'location'
  | 'professional'
  | 'education'
  | 'experience'
  | 'skills'
  | 'application'
  | 'work_authorization'
  | 'preferences'
  | 'demographic'
  | 'file_upload'
  | 'custom_question'
  | 'unknown';

export const FIELD_CATEGORIES: Record<FieldCategory, string[]> = {
  identity: [
    'full_name', 'first_name', 'middle_name', 'last_name',
    'email', 'phone', 'date_of_birth',
  ],
  location: [
    'address', 'city', 'state', 'country', 'zip_code', 'postal_code',
  ],
  professional: [
    'current_title', 'current_company', 'years_experience',
    'professional_summary', 'linkedin', 'github', 'portfolio',
  ],
  education: [
    'university', 'degree', 'field_of_study', 'graduation_year', 'gpa',
  ],
  experience: [
    'company', 'job_title', 'start_date', 'end_date', 'responsibilities',
  ],
  skills: [
    'skills', 'programming_languages', 'frameworks', 'databases', 'cloud',
  ],
  application: [
    'cover_letter', 'why_company', 'why_role', 'why_you',
    'career_goals', 'salary_expectation', 'notice_period', 'availability',
  ],
  work_authorization: [
    'authorized_to_work', 'requires_sponsorship', 'visa_status',
  ],
  preferences: [
    'remote', 'relocation', 'employment_type',
  ],
  demographic: [
    'gender', 'ethnicity', 'veteran_status', 'disability_status',
  ],
  file_upload: [
    'resume', 'cover_letter_file', 'portfolio_file', 'transcript',
  ],
  custom_question: [
    'open_ended', 'behavioral', 'technical', 'culture',
  ],
  unknown: [],
};

export interface FieldFingerprint {
  label: string;
  name: string;
  placeholder: string;
  type: string;
  surroundingText: string;
  domPath: string;
}

/**
 * Stable identity of a field across rescans.
 *
 * Only structural signals are hashed — deliberately excluding volatile text
 * such as surrounding copy, which changes whenever unrelated parts of the
 * page mutate. The same untouched field keeps the same fingerprint (and thus
 * the same id) across repeated scans, so rescans never reprocess it as new.
 */
export function computeFingerprint(field: SemanticField): string {
  const parts = [
    field.label || '',
    field.name || '',
    field.placeholder || '',
    field.type || '',
    field.section || '',
  ];
  const str = parts.join('|').toLowerCase().trim();
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}