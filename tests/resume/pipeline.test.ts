import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeResume } from '../../extension/src/resume/normalizer';
import { validateProfile } from '../../extension/src/resume/profileSchema';

const FIXTURE = path.resolve(__dirname, '../fixtures/resumes/sample-resume.txt');

function loadFixture(): string {
  return readFileSync(FIXTURE, 'utf-8');
}

describe('resume parsing pipeline (fixture resume)', () => {
  const profile = normalizeResume(loadFixture());

  it('produces a profile that passes schema validation', () => {
    const result = validateProfile(profile);
    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error(result.errors.join('; '));
    expect(result.profile.metadata.source).toBe('resume');
  });

  it('extracts identity and links', () => {
    expect(profile.personal.fullName).toBe('Indrajeet Chouhan');
    expect(profile.personal.email).toBe('indrajeet@example-dev.io');
    expect(profile.personal.phone).toContain('98765');
    expect(profile.personal.city).toBe('Bengaluru');
    expect(profile.links.github).toContain('github.com/indrajeet');
    expect(profile.links.linkedin).toContain('linkedin.com/in/indrajeet-chouhan');
    expect(profile.links.portfolio).toContain('indrajeet.dev');
  });

  it('normalizes technology aliases to canonical names', () => {
    expect(profile.skills.frameworks).toContain('Node.js');
    expect(profile.skills.frameworks).not.toContain('Node');
    expect(profile.skills.frameworks).not.toContain('NodeJS');
    expect(profile.skills.databases).toContain('PostgreSQL');
    expect(profile.skills.databases).not.toContain('Postgres');
    expect(profile.skills.devops).toEqual(
      expect.arrayContaining(['Docker', 'Kubernetes', 'Terraform', 'GitHub Actions'])
    );
    expect(profile.skills.cloud).toEqual(expect.arrayContaining(['AWS', 'GCP']));
  });

  it('parses experience with technologies from the Tech line', () => {
    expect(profile.experience).toHaveLength(2);
    const [current, previous] = profile.experience;
    expect(current.title).toBe('Senior Software Engineer');
    expect(current.company).toBe('Acme Technologies');
    expect(current.current).toBe(true);
    expect(current.technologies).toEqual(
      expect.arrayContaining(['Node.js', 'React', 'PostgreSQL', 'Redis', 'AWS'])
    );
    expect(previous.company).toBe('Startup Labs Pvt Ltd');
    expect(previous.endDate).toBe('2021-12');
  });

  it('parses education and projects', () => {
    expect(profile.education).toHaveLength(1);
    expect(profile.education[0].graduationYear).toBe(2019);
    const talentIq = profile.projects.find((p) => p.name === 'Talent-IQ');
    expect(talentIq).toBeDefined();
    expect(talentIq?.technologies).toEqual(
      expect.arrayContaining(['Node.js', 'TypeScript', 'PostgreSQL', 'Redis'])
    );
    expect(talentIq?.url).toContain('github.com/indrajeet/talent-iq');
  });

  it('builds a capability index backed by evidence', () => {
    expect(profile.capabilities.length).toBeGreaterThan(10);

    const redis = profile.capabilities.find((c) => c.name === 'Redis');
    expect(redis).toBeDefined();
    expect(redis?.category).toBe('database');
    const sources = new Set(redis?.evidence.map((e) => e.source));
    expect(sources).toEqual(new Set(['resume', 'experience', 'project']));
    expect(redis?.evidence.find((e) => e.source === 'project')?.reference).toBe('Talent-IQ');
    expect(redis?.confidence).toBeGreaterThan(0.9);

    const node = profile.capabilities.find((c) => c.name === 'Node.js');
    expect(node?.category).toBe('framework');
    expect(node?.evidence.some((e) => e.source === 'experience')).toBe(true);

    for (const capability of profile.capabilities) {
      expect(capability.evidence.length).toBeGreaterThan(0);
      expect(capability.confidence).toBeGreaterThan(0);
      expect(capability.confidence).toBeLessThanOrEqual(0.99);
    }
  });

  it('keeps capabilities sorted by descending confidence', () => {
    const confidences = profile.capabilities.map((c) => c.confidence);
    expect([...confidences].sort((a, b) => b - a)).toEqual(confidences);
  });
});
