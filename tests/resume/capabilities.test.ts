import { describe, expect, it } from 'vitest';
import { EMPTY_CANDIDATE_PROFILE, type CandidateProfile } from '@schemas/candidate';
import { extractCapabilities } from '../../extension/src/resume/capabilities';

type Source = Parameters<typeof extractCapabilities>[0];

function buildSource(overrides: Partial<Source> = {}): Source {
  return {
    ...EMPTY_CANDIDATE_PROFILE,
    skills: {
      programmingLanguages: ['TypeScript'],
      frameworks: ['React'],
      databases: ['Redis', 'Postgres'],
      cloud: ['AWS'],
      devops: [],
      tools: [],
      other: [],
    },
    experience: [],
    projects: [],
    education: [],
    ...overrides,
  } satisfies Source;
}

describe('extractCapabilities', () => {
  it('records resume skills as evidence with a category', () => {
    const capabilities = extractCapabilities(buildSource());
    const redis = capabilities.find((c) => c.name === 'Redis');
    expect(redis).toBeDefined();
    expect(redis?.category).toBe('database');
    expect(redis?.evidence).toEqual([
      { source: 'resume', description: 'Listed in the resume skills section (database)' },
    ]);
    expect(redis?.confidence).toBeGreaterThan(0);
    expect(redis?.confidence).toBeLessThanOrEqual(0.99);
  });

  it('normalizes aliases so Node/NodeJS collapse into Node.js', () => {
    const source = buildSource({
      skills: {
        programmingLanguages: [],
        frameworks: ['Node', 'NodeJS', 'Node.js'],
        databases: [],
        cloud: [],
        devops: [],
        tools: [],
        other: [],
      },
    });
    const capabilities = extractCapabilities(source);
    const names = capabilities.map((c) => c.name);
    expect(names).toContain('Node.js');
    expect(names).not.toContain('Node');
    expect(names).not.toContain('NodeJS');
  });

  it('does not double count duplicate skill listings', () => {
    const source = buildSource({
      skills: {
        programmingLanguages: [],
        frameworks: [],
        databases: ['Redis', 'Redis'],
        cloud: [],
        devops: [],
        tools: [],
        other: [],
      },
    });
    const redis = extractCapabilities(source).find((c) => c.name === 'Redis');
    expect(redis?.evidence).toHaveLength(1);
  });

  it('cites the role for structured experience technologies', () => {
    const source = buildSource({
      experience: [
        {
          id: 'exp-1',
          company: 'Acme Technologies',
          title: 'Senior Software Engineer',
          startDate: '2022-01',
          current: true,
          technologies: ['PostgreSQL', 'Redis'],
        },
      ],
    });
    const redis = extractCapabilities(source).find((c) => c.name === 'Redis');
    expect(redis?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'experience',
          reference: 'Senior Software Engineer @ Acme Technologies',
          description: 'Listed as a technology used in this role',
        }),
      ])
    );
  });

  it('captures free-text mentions inside role bullets as quoted snippets', () => {
    const source = buildSource({
      experience: [
        {
          id: 'exp-1',
          company: 'Acme Technologies',
          title: 'Site Reliability Engineer',
          startDate: '2022-01',
          current: true,
          responsibilities: ['Operated a Kubernetes cluster serving 2M requests per day'],
        },
      ],
    });
    const kubernetes = extractCapabilities(source).find((c) => c.name === 'Kubernetes');
    expect(kubernetes?.evidence[0]?.source).toBe('experience');
    expect(kubernetes?.evidence[0]?.description).toContain('Mentioned in role details');
    expect(kubernetes?.evidence[0]?.description).toContain('Kubernetes cluster');
  });

  it('cites the project for project technologies and highlights', () => {
    const source = buildSource({
      projects: [
        {
          id: 'proj-1',
          name: 'Talent-IQ',
          description: 'Talent scoring backend',
          technologies: ['Redis'],
          highlights: ['Used Redis in backend application for caching'],
        },
      ],
    });
    const redis = extractCapabilities(source).find((c) => c.name === 'Redis');
    expect(redis?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'project',
          reference: 'Talent-IQ',
          description: 'Listed in the project technology stack',
        }),
      ])
    );
    // structured technology wins over the bullet for the same reference
    expect(redis?.evidence.filter((e) => e.source === 'project')).toHaveLength(1);
  });

  it('ranks capabilities with more corroborating evidence higher', () => {
    const skillsOnly = extractCapabilities(buildSource()).find((c) => c.name === 'Redis');
    const corroborated = extractCapabilities(
      buildSource({
        experience: [
          {
            id: 'exp-1',
            company: 'Acme Technologies',
            title: 'Backend Engineer',
            startDate: '2022-01',
            current: true,
            technologies: ['Redis'],
          },
        ],
        projects: [
          {
            id: 'proj-1',
            name: 'Talent-IQ',
            technologies: ['Redis'],
          },
        ],
      })
    ).find((c) => c.name === 'Redis');

    expect(skillsOnly?.confidence).toBeLessThan(corroborated?.confidence ?? 0);
    expect(corroborated?.confidence).toBe(0.99);
  });

  it('cites education entries when skills appear there', () => {
    const source = buildSource({
      education: [
        {
          id: 'edu-1',
          institution: 'IIT Bombay',
          degree: 'B.Tech',
          fieldOfStudy: 'Computer Science and Engineering with coursework in Distributed Systems and Redis',
        },
      ],
    });
    const capabilities = extractCapabilities(source);
    const redis = capabilities.find((c) => c.name === 'Redis');
    expect(redis?.evidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: 'education' })])
    );
  });

  it('returns a deterministic confidence-descending list', () => {
    const source = buildSource({
      experience: [
        {
          id: 'exp-1',
          company: 'Acme',
          title: 'Engineer',
          startDate: '2022-01',
          current: true,
          technologies: ['Redis', 'TypeScript'],
        },
      ],
    });
    const capabilities = extractCapabilities(source);
    const confidences = capabilities.map((c) => c.confidence);
    expect([...confidences].sort((a, b) => b - a)).toEqual(confidences);
    for (const capability of capabilities) {
      expect(capability.confidence).toBeGreaterThan(0);
      expect(capability.confidence).toBeLessThanOrEqual(0.99);
      expect(capability.evidence.length).toBeGreaterThan(0);
    }
  });

  it('handles an empty profile without throwing', () => {
    const capabilities = extractCapabilities(EMPTY_CANDIDATE_PROFILE as CandidateProfile);
    expect(capabilities).toEqual([]);
  });
});
