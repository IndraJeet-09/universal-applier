import { describe, expect, it } from 'vitest';
import {
  EMPTY_CANDIDATE_PROFILE,
  flattenSkills,
  type CandidateProfile,
} from '@schemas/candidate';
import {
  candidateProfileSchema,
  mergeWithDefaults,
  validateProfile,
} from '../../extension/src/resume/profileSchema';

function buildProfile(overrides: Partial<CandidateProfile> = {}): CandidateProfile {
  return {
    ...EMPTY_CANDIDATE_PROFILE,
    personal: {
      fullName: 'Indrajeet Chouhan',
      firstName: 'Indrajeet',
      lastName: 'Chouhan',
      email: 'indrajeet@example-dev.io',
      phone: '+91 98765 43210',
      location: 'Bengaluru, Karnataka, India',
      city: 'Bengaluru',
      country: 'India',
    },
    professional: {
      headline: 'Senior Full-Stack Engineer',
      yearsOfExperience: 6,
      currentRole: 'Senior Software Engineer',
      currentCompany: 'Acme Technologies',
    },
    education: [
      {
        id: 'edu-1',
        institution: 'Indian Institute of Technology, Bombay',
        degree: 'Bachelor of Technology',
        fieldOfStudy: 'Computer Science and Engineering',
        graduationYear: 2019,
      },
    ],
    experience: [
      {
        id: 'exp-1',
        company: 'Acme Technologies',
        title: 'Senior Software Engineer',
        startDate: '2022-01',
        current: true,
        technologies: ['Node.js', 'Redis'],
      },
    ],
    projects: [
      {
        id: 'proj-1',
        name: 'Talent-IQ',
        description: 'Backend service for talent scoring',
        technologies: ['TypeScript', 'PostgreSQL'],
      },
    ],
    skills: {
      programmingLanguages: ['TypeScript', 'Go'],
      frameworks: ['React', 'Node.js'],
      databases: ['PostgreSQL', 'Redis'],
      cloud: ['AWS'],
      devops: ['Docker', 'Kubernetes'],
      tools: ['Git'],
      other: [],
    },
    capabilities: [
      {
        name: 'Redis',
        category: 'database',
        evidence: [{ source: 'resume', description: 'Listed in the resume skills section (database)' }],
        confidence: 0.7,
      },
    ],
    links: { github: 'https://github.com/indrajeet' },
    applicationAnswers: [
      {
        id: 'ans-1',
        question: 'Why do you want to work here?',
        answer: 'I admire your developer tooling.',
        scope: 'global',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    ...overrides,
  };
}

describe('candidateProfileSchema', () => {
  it('accepts the empty profile', () => {
    const result = validateProfile(EMPTY_CANDIDATE_PROFILE);
    expect(result.valid).toBe(true);
  });

  it('accepts a fully populated profile', () => {
    const result = validateProfile(buildProfile());
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.profile.personal.fullName).toBe('Indrajeet Chouhan');
      expect(result.profile.capabilities).toHaveLength(1);
    }
  });

  it('requires the capability index to be present', () => {
    const legacy = buildProfile();
    delete (legacy as Partial<CandidateProfile>).capabilities;
    expect(validateProfile(legacy).valid).toBe(false);
  });

  it('rejects a profile without an email', () => {
    const invalid = buildProfile({ personal: { fullName: 'Indrajeet Chouhan', email: '' } });
    const result = validateProfile(invalid);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.join(' ')).toContain('personal.email');
  });

  it('rejects an application answer with an unknown scope', () => {
    const invalid = buildProfile();
    (invalid.applicationAnswers[0] as { scope: string }).scope = 'team';
    const result = validateProfile(invalid);
    expect(result.valid).toBe(false);
  });

  it('rejects capabilities with out-of-range confidence', () => {
    const invalid = buildProfile();
    invalid.capabilities[0].confidence = 1.5;
    expect(validateProfile(invalid).valid).toBe(false);
  });

  it('rejects profiles missing the devops skills bucket', () => {
    const invalid = buildProfile();
    delete (invalid.skills as Partial<typeof invalid.skills>).devops;
    expect(validateProfile(invalid).valid).toBe(false);
  });

  it('exposes zod issues as readable path messages', () => {
    const result = validateProfile({ personal: {}, education: 'not-an-array' });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('candidateProfileSchema merge helpers', () => {
  it('mergeWithDefaults fills missing buckets', () => {
    const merged = mergeWithDefaults({
      personal: { fullName: 'Indrajeet Chouhan', email: 'indrajeet@example-dev.io' },
      skills: { ...EMPTY_CANDIDATE_PROFILE.skills, databases: ['Redis'] },
    });
    expect(merged.skills.databases).toEqual(['Redis']);
    expect(merged.skills.devops).toEqual([]);
    expect(merged.capabilities).toEqual([]);
    expect(merged.applicationAnswers).toEqual([]);
  });

  it('mergeWithDefaults output still validates', () => {
    const merged = mergeWithDefaults({ personal: { fullName: 'A B', email: 'a@example-dev.io' } });
    expect(candidateProfileSchema.safeParse(merged).success).toBe(true);
  });
});

describe('flattenSkills', () => {
  it('returns every bucket in a stable order', () => {
    const skills = buildProfile().skills;
    expect(flattenSkills(skills)).toEqual([
      'TypeScript',
      'Go',
      'React',
      'Node.js',
      'PostgreSQL',
      'Redis',
      'AWS',
      'Docker',
      'Kubernetes',
      'Git',
    ]);
  });

  it('tolerates partial legacy skill objects', () => {
    expect(flattenSkills({ databases: ['Redis'] } as CandidateProfile['skills'])).toEqual(['Redis']);
    expect(flattenSkills(undefined)).toEqual([]);
  });
});
