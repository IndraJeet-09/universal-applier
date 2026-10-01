import type { FieldCategory } from '@schemas/dom';

export interface TaxonomyField {
  key: string;
  category: FieldCategory;
  sensitive?: boolean;
}

export const TAXONOMY: TaxonomyField[] = [
  { key: 'full_name', category: 'identity' },
  { key: 'first_name', category: 'identity' },
  { key: 'middle_name', category: 'identity' },
  { key: 'last_name', category: 'identity' },
  { key: 'email', category: 'identity' },
  { key: 'phone', category: 'identity' },
  { key: 'date_of_birth', category: 'identity' },

  { key: 'address', category: 'location' },
  { key: 'city', category: 'location' },
  { key: 'state', category: 'location' },
  { key: 'country', category: 'location' },
  { key: 'zip_code', category: 'location' },

  { key: 'current_title', category: 'professional' },
  { key: 'current_company', category: 'professional' },
  { key: 'years_experience', category: 'professional' },
  { key: 'professional_summary', category: 'professional' },
  { key: 'linkedin', category: 'professional' },
  { key: 'github', category: 'professional' },
  { key: 'portfolio', category: 'professional' },

  { key: 'university', category: 'education' },
  { key: 'degree', category: 'education' },
  { key: 'field_of_study', category: 'education' },
  { key: 'graduation_year', category: 'education' },
  { key: 'gpa', category: 'education' },

  { key: 'skills', category: 'skills' },
  { key: 'programming_languages', category: 'skills' },
  { key: 'frameworks', category: 'skills' },
  { key: 'databases', category: 'skills' },

  { key: 'cover_letter', category: 'application' },
  { key: 'why_company', category: 'application' },
  { key: 'why_role', category: 'application' },
  { key: 'why_you', category: 'application' },
  { key: 'career_goals', category: 'application' },
  { key: 'salary_expectation', category: 'application', sensitive: true },
  { key: 'notice_period', category: 'application', sensitive: true },
  { key: 'availability', category: 'application' },
  { key: 'referral_source', category: 'application' },

  { key: 'authorized_to_work', category: 'work_authorization', sensitive: true },
  { key: 'requires_sponsorship', category: 'work_authorization', sensitive: true },
  { key: 'visa_status', category: 'work_authorization', sensitive: true },

  { key: 'remote_preference', category: 'preferences' },
  { key: 'relocation', category: 'preferences', sensitive: true },
  { key: 'employment_type', category: 'preferences' },

  { key: 'gender', category: 'demographic', sensitive: true },
  { key: 'ethnicity', category: 'demographic', sensitive: true },
  { key: 'veteran_status', category: 'demographic', sensitive: true },
  { key: 'disability_status', category: 'demographic', sensitive: true },
  { key: 'pronouns', category: 'demographic', sensitive: true },

  { key: 'resume', category: 'file_upload' },
  { key: 'cover_letter_file', category: 'file_upload' },

  { key: 'terms_acceptance', category: 'application', sensitive: true },
];

export const TAXONOMY_KEYS = new Set(TAXONOMY.map((t) => t.key));

export const CATEGORY_BY_KEY: Record<string, FieldCategory> = Object.fromEntries(
  TAXONOMY.map((t) => [t.key, t.category])
);

export const SYNONYMS: Record<string, string[]> = {
  full_name: [
    'full name', 'name', 'your name', 'candidate name', 'applicant name',
    'first and last name', 'legal name', 'complete name', 'name of candidate',
  ],
  first_name: ['first name', 'firstname', 'given name', 'forename'],
  middle_name: ['middle name', 'middle initial'],
  last_name: ['last name', 'lastname', 'surname', 'family name'],
  email: [
    'email', 'email address', 'e-mail', 'e mail', 'contact email',
    'personal email', 'your email', 'email id', 'email address required',
  ],
  phone: [
    'phone', 'phone number', 'mobile', 'mobile number', 'telephone',
    'contact number', 'cell', 'cell phone', 'mobile phone', 'your phone',
    'phone no', 'primary phone',
  ],
  date_of_birth: [
    'date of birth', 'dob', 'birth date', 'birthday', 'born on', 'date of birth dob',
  ],

  address: ['address', 'street address', 'home address', 'mailing address', 'full address'],
  city: ['city', 'town', 'current city', 'city of residence'],
  state: ['state', 'province', 'region', 'state or province'],
  country: ['country', 'country of residence', 'nation'],
  zip_code: ['zip', 'zip code', 'postal code', 'postcode', 'pin code', 'pincode'],

  current_title: [
    'current title', 'current role', 'current position', 'job title',
    'title', 'role', 'position', 'most recent title', 'current job title',
  ],
  current_company: [
    'current company', 'current employer', 'employer', 'company',
    'most recent employer', 'present company', 'organization you work for',
  ],
  years_experience: [
    'years of experience', 'years experience', 'experience in years',
    'total experience', 'professional experience', 'years of professional experience',
    'yrs of experience', 'years worked', 'how many years of experience',
  ],
  professional_summary: [
    'summary', 'professional summary', 'profile summary', 'about you',
    'about me', 'bio', 'biography', 'professional bio', 'introduction',
  ],
  linkedin: ['linkedin', 'linkedin profile', 'linkedin url', 'linkedin link', 'linkedin address'],
  github: ['github', 'github profile', 'github url', 'github link', 'github username', 'github address'],
  portfolio: [
    'portfolio', 'portfolio url', 'portfolio link', 'website', 'personal website',
    'web site', 'homepage', 'personal site', 'portfolio website', 'online portfolio',
  ],

  university: [
    'university', 'college', 'school', 'institution', 'alma mater',
    'university or college', 'school name', 'name of institution',
  ],
  degree: ['degree', 'degree type', 'highest degree', 'qualification', 'degree obtained'],
  field_of_study: [
    'field of study', 'major', 'specialization', 'specialisation',
    'discipline', 'course', 'program of study', 'major or field',
  ],
  graduation_year: [
    'graduation year', 'year of graduation', 'graduation date', 'completion year',
    'expected graduation', 'year completed', 'passing year',
  ],
  gpa: ['gpa', 'grade', 'grades', 'academic performance', 'cgpa', 'cumulative gpa'],

  skills: [
    'skills', 'key skills', 'technical skills', 'core skills', 'competencies',
    'areas of expertise', 'skill set', 'skills summary',
  ],
  programming_languages: ['programming languages', 'languages', 'languages known'],
  frameworks: ['frameworks', 'frameworks and libraries', 'technologies'],
  databases: ['databases', 'database', 'database technologies', 'databases known', 'rdbms'],

  cover_letter: ['cover letter', 'cover letter text', 'letter of motivation'],
  why_company: [
    'why do you want to work here', 'why this company', 'why us',
    'why are you interested in this company', 'why do you want to join',
    'what interests you about this company', 'reason for applying',
  ],
  why_role: [
    'why this role', 'why this position', 'why are you interested in this position',
    'why do you want this job', 'why do you want this role', 'interest in this position',
  ],
  why_you: [
    'why should we hire you', 'tell us about yourself', 'tell me about yourself',
    'why you', 'what makes you a good fit', 'pitch yourself', 'about yourself',
  ],
  career_goals: ['career goals', 'professional goals', 'where do you see yourself'],
  salary_expectation: [
    'salary', 'expected salary', 'salary expectation', 'expected ctc',
    'compensation', 'desired salary', 'salary requirements', 'expected compensation',
    'what are your salary', 'ctc', 'expected annual salary',
  ],
  notice_period: [
    'notice period', 'notice period in days', 'how much notice',
    'current notice period', 'notice',
  ],
  availability: [
    'availability', 'available from', 'earliest start date', 'when can you start',
    'start date', 'available to start', 'joining date', 'how soon can you start',
  ],
  referral_source: ['how did you hear', 'source', 'referral', 'how did you find'],

  authorized_to_work: [
    'authorized to work', 'legally authorized', 'work authorization',
    'eligible to work', 'permission to work', 'right to work', 'authorized to work in',
  ],
  requires_sponsorship: [
    'visa sponsorship', 'require sponsorship', 'requires sponsorship',
    'sponsorship', 'need visa', 'require visa', 'visa required',
    'will you require sponsorship', 'do you require visa',
  ],
  visa_status: ['visa status', 'immigration status', 'work permit', 'visa type'],

  remote_preference: ['remote', 'remote preference', 'work from home', 'remote work', 'hybrid'],
  relocation: ['relocation', 'willing to relocate', 'relocate', 'open to relocation'],
  employment_type: [
    'employment type', 'job type', 'type of employment', 'work type',
    'full time', 'part time', 'contract',
  ],

  gender: ['gender', 'sex', 'gender identity'],
  ethnicity: ['ethnicity', 'race', 'racial or ethnic'],
  veteran_status: ['veteran status', 'veteran', 'protected veteran'],
  disability_status: ['disability status', 'disability', 'do you have a disability'],
  pronouns: ['pronouns', 'preferred pronouns'],

  resume: ['resume', 'cv', 'resume cv', 'upload resume', 'resume or cv', 'curriculum vitae'],
  cover_letter_file: ['cover letter upload', 'upload cover letter', 'cover letter file'],

  terms_acceptance: [
    'terms of service', 'terms and conditions', 'privacy policy',
    'i certify', 'certify that', 'i agree', 'terms of use', 'i acknowledge',
  ],
};

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(required|optional|optional field)\b/g, ' ')
    .replace(/[*:]+$/g, ' ')
    .replace(/[^a-z0-9\s/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isSensitiveKey(key: string): boolean {
  return TAXONOMY.find((t) => t.key === key)?.sensitive === true;
}

export function categoryForKey(key: string): FieldCategory {
  return CATEGORY_BY_KEY[key] ?? 'unknown';
}