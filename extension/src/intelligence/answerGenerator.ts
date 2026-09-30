import { flattenSkills, type CandidateProfile } from '@schemas/candidate';
import type { AnswerGenerationInput, QuestionType } from '@schemas/ai';
import type { JobContext } from '@schemas/dom';
import type { Links } from '@schemas/candidate';

export function linksToRecord(links: Links): Record<string, string> {
  const record: Record<string, string> = {};
  for (const key of ['github', 'linkedin', 'portfolio', 'twitter', 'website'] as const) {
    const value = links[key];
    if (typeof value === 'string' && value.length > 0) record[key] = value;
  }
  return record;
}

export function questionTypeFor(semanticField: string, category: string): QuestionType {
  switch (semanticField) {
    case 'why_company':
      return 'company_motivation';
    case 'why_role':
      return 'role_motivation';
    case 'why_you':
    case 'professional_summary':
      return 'experience_summary';
    case 'career_goals':
      return 'career_goals';
    case 'salary_expectation':
      return 'salary_expectation';
    case 'availability':
      return 'availability';
    case 'authorized_to_work':
    case 'requires_sponsorship':
    case 'visa_status':
      return 'work_authorization';
    default:
      break;
  }
  if (category === 'work_authorization') return 'work_authorization';
  if (category === 'experience' || category === 'professional') return 'experience_summary';
  return 'custom';
}

export interface AnswerQuestion {
  question: string;
  semanticField: string;
  category: string;
}

export function buildAnswerInput(
  profile: CandidateProfile,
  question: AnswerQuestion,
  jobContext?: JobContext
): AnswerGenerationInput {
  return {
    question: question.question,
    questionType: questionTypeFor(question.semanticField, question.category),
    candidateProfile: {
      personal: {
        fullName: profile.personal.fullName,
        email: profile.personal.email,
        location: profile.personal.city ?? profile.personal.location,
      },
      professional: {
        headline: profile.professional.headline,
        summary: profile.professional.summary,
        yearsOfExperience: profile.professional.yearsOfExperience,
      },
      experience: profile.experience.map((entry) => ({
        title: entry.title,
        company: entry.company,
        description: entry.description,
        technologies: entry.technologies,
      })),
      education: profile.education.map((entry) => ({
        degree: entry.degree,
        institution: entry.institution,
        fieldOfStudy: entry.fieldOfStudy,
      })),
      skills: flattenSkills(profile.skills),
      projects: profile.projects.map((project) => ({
        name: project.name,
        description: project.description,
        technologies: project.technologies,
      })),
      links: linksToRecord(profile.links),
    },
    ...(jobContext ? { jobContext } : {}),
    ...(jobContext?.company ? { companyContext: jobContext.company } : {}),
  };
}
