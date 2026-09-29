import { describe, expect, it } from 'vitest';
import type { CandidateProfile } from '@schemas/candidate';
import type { JobContext } from '@schemas/dom';
import {
  questionTypeFor,
  buildAnswerInput,
} from '../../extension/src/intelligence/answerGenerator';

function makeProfile(): CandidateProfile {
  return {
    personal: { fullName: 'John Doe', email: 'john@example.com', city: 'Bengaluru' },
    professional: {
      headline: 'Senior Engineer',
      summary: 'Builds developer tooling',
      yearsOfExperience: 6,
      currentRole: 'Senior Software Engineer',
      currentCompany: 'Acme',
    },
    experience: [
      {
        id: 'e1',
        company: 'Acme',
        title: 'Senior Software Engineer',
        startDate: '2022-01',
        current: true,
        description: 'Owned the autofill platform',
        technologies: ['TypeScript', 'React'],
      },
    ],
    education: [
      {
        id: 'd1',
        institution: 'IIT Bombay',
        degree: 'B.Tech',
        fieldOfStudy: 'Computer Science',
        graduationYear: 2019,
      },
    ],
    skills: {
      programmingLanguages: ['TypeScript', 'Python'],
      frameworks: ['React'],
      databases: ['PostgreSQL'],
      cloud: ['AWS'],
      tools: ['Git'],
      other: ['Figma'],
    },
    projects: [{ id: 'p1', name: 'Autofill Engine', description: 'Chrome extension', technologies: ['TypeScript'] }],
    links: { github: 'https://github.com/john' },
    applicationAnswers: [],
  } as unknown as CandidateProfile;
}

describe('questionTypeFor', () => {
  it('maps semantic fields to question types', () => {
    expect(questionTypeFor('why_company', 'application')).toBe('company_motivation');
    expect(questionTypeFor('why_role', 'application')).toBe('role_motivation');
    expect(questionTypeFor('career_goals', 'application')).toBe('career_goals');
    expect(questionTypeFor('salary_expectation', 'application')).toBe('salary_expectation');
    expect(questionTypeFor('availability', 'application')).toBe('availability');
    expect(questionTypeFor('requires_sponsorship', 'work_authorization')).toBe('work_authorization');
    expect(questionTypeFor('professional_summary', 'professional')).toBe('experience_summary');
  });

  it('falls back through category then custom', () => {
    expect(questionTypeFor('unknown', 'work_authorization')).toBe('work_authorization');
    expect(questionTypeFor('unknown', 'experience')).toBe('experience_summary');
    expect(questionTypeFor('random_question', 'custom_question')).toBe('custom');
  });
});

describe('buildAnswerInput', () => {
  it('projects the candidate profile into the AI input shape', () => {
    const input = buildAnswerInput(makeProfile(), {
      question: 'Why do you want to work here?',
      semanticField: 'why_company',
      category: 'application',
    });

    expect(input.questionType).toBe('company_motivation');
    expect(input.candidateProfile.personal.fullName).toBe('John Doe');
    expect(input.candidateProfile.personal.location).toBe('Bengaluru');
    expect(input.candidateProfile.professional.yearsOfExperience).toBe(6);
    expect(input.candidateProfile.experience[0].title).toBe('Senior Software Engineer');
    expect(input.candidateProfile.education[0].degree).toBe('B.Tech');
    expect(input.candidateProfile.skills).toEqual(
      expect.arrayContaining(['TypeScript', 'React', 'PostgreSQL', 'AWS', 'Git', 'Figma'])
    );
    expect(input.candidateProfile.projects[0].name).toBe('Autofill Engine');
    expect(input.candidateProfile.links.github).toBe('https://github.com/john');
    expect(input.jobContext).toBeUndefined();
  });

  it('includes job and company context when provided', () => {
    const jobContext: JobContext = {
      title: 'Frontend Engineer',
      company: 'Acme Corp',
      description: 'React-heavy product team',
    };
    const input = buildAnswerInput(
      makeProfile(),
      { question: 'Describe a project', semanticField: 'unknown', category: 'custom_question' },
      jobContext
    );
    expect(input.jobContext).toEqual(jobContext);
    expect(input.companyContext).toBe('Acme Corp');
  });
});
