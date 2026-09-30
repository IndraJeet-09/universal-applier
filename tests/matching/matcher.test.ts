import { describe, expect, it } from 'vitest';
import { resolveValue, matchOption, findSavedAnswer } from '../../extension/src/intelligence/candidateMatcher';
import { decideFill } from '../../extension/src/intelligence/confidence';
import { EMPTY_CANDIDATE_PROFILE, type CandidateProfile } from '@schemas/candidate';

function makeProfile(overrides: Partial<CandidateProfile> = {}): CandidateProfile {
  return {
    ...EMPTY_CANDIDATE_PROFILE,
    personal: {
      ...EMPTY_CANDIDATE_PROFILE.personal,
      fullName: 'John A. Doe',
      email: 'john@example-dev.io',
      phone: '+91 98765 43210',
      city: 'Bengaluru',
      country: 'India',
    },
    professional: {
      currentRole: 'Senior Software Engineer',
      currentCompany: 'Acme Technologies',
      yearsOfExperience: 6,
      noticePeriod: '30 days',
      ...overrides.professional,
    },
    links: {
      github: 'https://github.com/johndoe',
      linkedin: 'https://linkedin.com/in/john-doe',
      portfolio: 'https://johndoe.dev',
    },
    education: [
      {
        id: 'edu-1',
        institution: 'Indian Institute of Technology, Bombay',
        degree: 'Bachelor of Technology',
        fieldOfStudy: 'Computer Science and Engineering',
        graduationYear: 2019,
        gpa: '8.9/10',
      },
    ],
    experience: [
      {
        id: 'exp-1',
        company: 'Acme Technologies',
        title: 'Senior Software Engineer',
        startDate: '2022-01',
        endDate: undefined,
        current: true,
      },
    ],
    skills: {
      programmingLanguages: ['TypeScript', 'Python'],
      frameworks: ['React', 'Node.js'],
      databases: ['PostgreSQL'],
      cloud: ['AWS'],
      devops: [],
      tools: ['Git'],
      other: [],
    },
    ...overrides,
  };
}

describe('resolveValue', () => {
  const profile = makeProfile();

  it('resolves core identity fields', () => {
    expect(resolveValue('full_name', profile).value).toBe('John A. Doe');
    expect(resolveValue('first_name', profile).value).toBe('John');
    expect(resolveValue('last_name', profile).value).toBe('Doe');
    expect(resolveValue('email', profile).value).toBe('john@example-dev.io');
    expect(resolveValue('phone', profile).value).toBe('+91 98765 43210');
    expect(resolveValue('city', profile).value).toBe('Bengaluru');
  });

  it('resolves professional and education fields', () => {
    expect(resolveValue('current_title', profile).value).toBe('Senior Software Engineer');
    expect(resolveValue('current_company', profile).value).toBe('Acme Technologies');
    expect(resolveValue('years_experience', profile).value).toBe('6');
    expect(resolveValue('github', profile).value).toBe('https://github.com/johndoe');
    expect(resolveValue('linkedin', profile).value).toBe('https://linkedin.com/in/john-doe');
    expect(resolveValue('portfolio', profile).value).toBe('https://johndoe.dev');
    expect(resolveValue('university', profile).value).toBe('Indian Institute of Technology, Bombay');
    expect(resolveValue('degree', profile).value).toBe('Bachelor of Technology');
    expect(resolveValue('graduation_year', profile).value).toBe('2019');
    expect(resolveValue('gpa', profile).value).toBe('8.9/10');
    expect(resolveValue('programming_languages', profile).value).toBe('TypeScript, Python');
  });

  it('never invents missing information', () => {
    const empty = makeProfile({ professional: { yearsOfExperience: undefined } });
    expect(resolveValue('years_experience', empty).value).toBeNull();

    expect(resolveValue('salary_expectation', profile).value).toBeNull();
    expect(resolveValue('date_of_birth', profile).value).toBeNull();
    expect(resolveValue('zip_code', profile).value).toBeNull();

    const noAuth = makeProfile();
    noAuth.workAuthorization = {};
    expect(resolveValue('authorized_to_work', noAuth).value).toBeNull();
    expect(resolveValue('requires_sponsorship', noAuth).value).toBeNull();
  });

  it('never answers demographic questions', () => {
    for (const field of ['gender', 'ethnicity', 'veteran_status', 'disability_status', 'terms_acceptance']) {
      expect(resolveValue(field, profile).value).toBeNull();
    }
  });

  it('uses explicit work authorization only when provided', () => {
    const withAuth = makeProfile();
    withAuth.workAuthorization = { authorizedToWork: true, requiresSponsorship: false };
    expect(resolveValue('authorized_to_work', withAuth).value).toBe('Yes');
    expect(resolveValue('requires_sponsorship', withAuth).value).toBe('No');
  });

  it('reuses saved answers semantically', () => {
    const withAnswers = makeProfile();
    withAnswers.applicationAnswers = [
      {
        id: 'a1',
        question: 'What is your preferred notice period?',
        answer: 'Immediate',
        scope: 'global',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
    const result = resolveValue('notice_period', withAnswers, 'How much notice do you need to serve?');
    expect(result.value).toBe('Immediate');
    expect(result.source).toBe('saved_answer');
  });
});

describe('matchOption', () => {
  it('maps yes/no answers', () => {
    expect(matchOption(['Yes', 'No'], 'Yes')).toBe('Yes');
    expect(matchOption(['Yes', 'No'], 'true')).toBe('Yes');
    expect(matchOption(['Yes', 'No'], 'No')).toBe('No');
  });

  it('maps degree names to short options', () => {
    expect(matchOption(['B.Tech', "Bachelor's", "Master's"], 'Bachelor of Technology')).toBe('B.Tech');
    expect(matchOption(['High School', "Bachelor's", "Master's"], "Master's degree")).toBe("Master's");
  });

  it('maps numeric values into ranges', () => {
    expect(matchOption(['0-2 years', '3-5 years', '5-8 years', '8+ years'], '6')).toBe('5-8 years');
    expect(matchOption(['0-2 years', '3-5 years', '8+ years'], '10')).toBe('8+ years');
  });

  it('returns null when nothing matches', () => {
    expect(matchOption(['A', 'B'], 'quantum physics')).toBeNull();
  });
});

describe('findSavedAnswer', () => {
  const answers = [
    {
      id: 'a1',
      question: 'Are you authorized to work in India?',
      answer: 'Yes',
      scope: 'global' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  it('matches paraphrased questions', () => {
    const found = findSavedAnswer('Do you have permission to work in India?', answers);
    expect(found?.answer).toBe('Yes');
  });
});

describe('decideFill policy', () => {
  const base = {
    sensitive: false,
    hasValue: true,
    autoFillHighConfidence: true,
    requireConfirmation: true,
    skipSensitiveFields: true,
  };

  it('auto-fills high confidence', () => {
    expect(decideFill({ ...base, confidence: 0.97 })).toBe('auto_fill');
  });

  it('fills medium confidence with highlight', () => {
    expect(decideFill({ ...base, confidence: 0.85 })).toBe('fill_highlight');
    expect(decideFill({ ...base, confidence: 0.9 })).toBe('fill_highlight');
  });

  it('asks for low confidence', () => {
    expect(decideFill({ ...base, confidence: 0.65 })).toBe('ask_user');
  });

  it('skips very low confidence', () => {
    expect(decideFill({ ...base, confidence: 0.4 })).toBe('skip');
  });

  it('always asks for sensitive fields with values', () => {
    expect(decideFill({ ...base, confidence: 0.99, sensitive: true })).toBe('ask_user');
  });

  it('skips when no value is available', () => {
    expect(decideFill({ ...base, confidence: 0.99, hasValue: false })).toBe('skip');
  });
});