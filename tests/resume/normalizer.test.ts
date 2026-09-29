import { describe, expect, it } from 'vitest';
import { normalizeResume } from '../../extension/src/resume/normalizer';

const SAMPLE_RESUME = `John A. Doe
Senior Full-Stack Engineer
Bengaluru, Karnataka, India
john.doe@example-dev.io | +91 98765 43210
github.com/johndoe | linkedin.com/in/john-doe

PROFESSIONAL SUMMARY
Full-stack engineer with 6 years of experience building web platforms.

SKILLS
Languages: TypeScript, JavaScript, Python, SQL
Frameworks: React, Next.js, Node.js, Express
Databases: PostgreSQL, MongoDB, Redis
Tools: Docker, AWS, Git, GitHub Actions

EXPERIENCE

Senior Software Engineer — Acme Technologies, Bengaluru
Jan 2022 - Present
- Led migration of a monolith to microservices on AWS
- Mentored 4 engineers; cut deploy time by 60%

Software Engineer at Startup Labs Pvt Ltd, Remote
Jun 2019 – Dec 2021
- Built a React dashboard used by 10k users

EDUCATION

Indian Institute of Technology, Bombay
B.Tech in Computer Science and Engineering
2015 - 2019
GPA: 8.9/10

PROJECTS

Student Buddy
- Mobile app built with React Native for campus notices
- github.com/johndoe/student-buddy

CERTIFICATIONS

AWS Certified Solutions Architect - Amazon, 2023
`;

describe('normalizeResume', () => {
  const profile = normalizeResume(SAMPLE_RESUME);

  it('extracts personal info', () => {
    expect(profile.personal.fullName).toBe('John A. Doe');
    expect(profile.personal.firstName).toBe('John');
    expect(profile.personal.lastName).toBe('Doe');
    expect(profile.personal.email).toBe('john.doe@example-dev.io');
    expect(profile.personal.phone).toContain('98765');
    expect(profile.personal.city).toBe('Bengaluru');
  });

  it('extracts links', () => {
    expect(profile.links.github).toContain('github.com/johndoe');
    expect(profile.links.linkedin).toContain('linkedin.com/in/john-doe');
  });

  it('parses experience entries', () => {
    expect(profile.experience).toHaveLength(2);

    const current = profile.experience[0];
    expect(current.title).toBe('Senior Software Engineer');
    expect(current.company).toBe('Acme Technologies');
    expect(current.location).toBe('Bengaluru');
    expect(current.current).toBe(true);
    expect(current.startDate).toBe('2022-01');
    expect(current.responsibilities?.length).toBeGreaterThanOrEqual(2);

    const previous = profile.experience[1];
    expect(previous.title).toBe('Software Engineer');
    expect(previous.company).toBe('Startup Labs Pvt Ltd');
    expect(previous.startDate).toBe('2019-06');
    expect(previous.endDate).toBe('2021-12');
    expect(previous.current).toBe(false);
  });

  it('parses education entries', () => {
    expect(profile.education).toHaveLength(1);
    const edu = profile.education[0];
    expect(edu.institution).toBe('Indian Institute of Technology, Bombay');
    expect(edu.degree).toBe('Bachelor of Technology');
    expect(edu.fieldOfStudy).toBe('Computer Science and Engineering');
    expect(edu.graduationYear).toBe(2019);
    expect(edu.gpa).toBe('8.9/10');
  });

  it('normalizes and categorizes skills', () => {
    expect(profile.skills.programmingLanguages).toContain('TypeScript');
    expect(profile.skills.programmingLanguages).toContain('Python');
    expect(profile.skills.frameworks).toContain('React');
    expect(profile.skills.frameworks).toContain('Node.js');
    expect(profile.skills.databases).toContain('PostgreSQL');
    expect(profile.skills.cloud).toContain('AWS');
    expect(profile.skills.tools).toContain('Git');
  });

  it('parses projects and certifications', () => {
    expect(profile.projects).toHaveLength(1);
    expect(profile.projects[0].name).toBe('Student Buddy');
    expect(profile.projects[0].url).toContain('github.com');

    expect(profile.certifications).toHaveLength(1);
    expect(profile.certifications[0].name).toContain('AWS Certified Solutions Architect');
    expect(profile.certifications[0].issueDate).toBe('2023');
  });

  it('derives professional metadata', () => {
    expect(profile.professional.summary).toContain('Full-stack engineer');
    expect(profile.professional.currentRole).toBe('Senior Software Engineer');
    expect(profile.professional.currentCompany).toBe('Acme Technologies');
    expect(profile.professional.yearsOfExperience).toBeGreaterThanOrEqual(6);
    expect(profile.metadata.source).toBe('resume');
  });
});