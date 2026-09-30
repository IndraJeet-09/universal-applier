import { z } from 'zod';
import type { CandidateProfile } from '@schemas/candidate';
import { EMPTY_CANDIDATE_PROFILE } from '@schemas/candidate';

const id = z.string().min(1);

const educationSchema = z.object({
  id,
  institution: z.string(),
  degree: z.string(),
  fieldOfStudy: z.string().optional(),
  graduationYear: z.number().int().optional(),
  gpa: z.string().optional(),
  location: z.string().optional(),
  honors: z.array(z.string()).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

const experienceSchema = z.object({
  id,
  company: z.string(),
  title: z.string(),
  location: z.string().optional(),
  startDate: z.string(),
  endDate: z.string().optional(),
  current: z.boolean(),
  description: z.string().optional(),
  responsibilities: z.array(z.string()).optional(),
  technologies: z.array(z.string()).optional(),
  achievements: z.array(z.string()).optional(),
});

const projectSchema = z.object({
  id,
  name: z.string(),
  description: z.string().optional(),
  technologies: z.array(z.string()).optional(),
  url: z.string().optional(),
  githubUrl: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  highlights: z.array(z.string()).optional(),
});

const certificationSchema = z.object({
  id,
  name: z.string(),
  issuer: z.string().optional(),
  issueDate: z.string().optional(),
  expiryDate: z.string().optional(),
  credentialId: z.string().optional(),
  url: z.string().optional(),
});

const applicationAnswerSchema = z.object({
  id,
  question: z.string(),
  answer: z.string(),
  tags: z.array(z.string()).optional(),
  scope: z.enum(['global', 'company', 'role']),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const skillsSchema = z.object({
  programmingLanguages: z.array(z.string()),
  frameworks: z.array(z.string()),
  databases: z.array(z.string()),
  cloud: z.array(z.string()),
  devops: z.array(z.string()),
  tools: z.array(z.string()),
  other: z.array(z.string()),
});

const capabilitySchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  evidence: z.array(
    z.object({
      source: z.enum(['resume', 'project', 'experience', 'education', 'user']),
      reference: z.string().optional(),
      description: z.string().optional(),
    })
  ),
  confidence: z.number().min(0).max(1),
});

export const candidateProfileSchema: z.ZodType<CandidateProfile> = z.object({
  personal: z.object({
    fullName: z.string(),
    firstName: z.string().optional(),
    middleName: z.string().optional(),
    lastName: z.string().optional(),
    email: z.string(),
    phone: z.string().optional(),
    location: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional(),
    postalCode: z.string().optional(),
    address: z.string().optional(),
    dateOfBirth: z.string().optional(),
  }),
  professional: z.object({
    headline: z.string().optional(),
    summary: z.string().optional(),
    yearsOfExperience: z.number().optional(),
    currentRole: z.string().optional(),
    currentCompany: z.string().optional(),
    desiredRoles: z.array(z.string()).optional(),
    preferredLocations: z.array(z.string()).optional(),
    remotePreference: z.enum(['remote', 'hybrid', 'onsite', 'any']).optional(),
    relocation: z.boolean().optional(),
    noticePeriod: z.string().optional(),
    salaryExpectation: z
      .object({
        min: z.number().optional(),
        max: z.number().optional(),
        currency: z.string().optional(),
        period: z.enum(['year', 'month', 'hour']).optional(),
      })
      .optional(),
  }),
  education: z.array(educationSchema),
  experience: z.array(experienceSchema),
  projects: z.array(projectSchema),
  skills: skillsSchema,
  capabilities: z.array(capabilitySchema),
  certifications: z.array(certificationSchema),
  links: z.object({
    github: z.string().optional(),
    linkedin: z.string().optional(),
    portfolio: z.string().optional(),
    twitter: z.string().optional(),
    website: z.string().optional(),
    other: z.array(z.string()).optional(),
  }),
  preferences: z.object({
    desiredRoles: z.array(z.string()).optional(),
    preferredLocations: z.array(z.string()).optional(),
    remotePreference: z.string().optional(),
    relocation: z.boolean().optional(),
  }),
  applicationAnswers: z.array(applicationAnswerSchema),
  workAuthorization: z.object({
    authorizedToWork: z.boolean().optional(),
    requiresSponsorship: z.boolean().optional(),
    visaStatus: z.string().optional(),
    citizenship: z.array(z.string()).optional(),
    workPermitExpiry: z.string().optional(),
  }),
  metadata: z.object({
    source: z.enum(['resume', 'manual', 'imported']),
    parsedAt: z.string(),
    version: z.number(),
  }),
});

export type ProfileValidationResult =
  | { valid: true; profile: CandidateProfile }
  | { valid: false; errors: string[] };

export function validateProfile(data: unknown): ProfileValidationResult {
  const result = candidateProfileSchema.safeParse(data);
  if (result.success) {
    return { valid: true, profile: result.data };
  }
  return {
    valid: false,
    errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
  };
}

export function mergeWithDefaults(profile: Partial<CandidateProfile>): CandidateProfile {
  return candidateProfileSchema.parse({
    ...EMPTY_CANDIDATE_PROFILE,
    ...profile,
    skills: { ...EMPTY_CANDIDATE_PROFILE.skills, ...(profile.skills ?? {}) },
    capabilities: profile.capabilities ?? EMPTY_CANDIDATE_PROFILE.capabilities,
    personal: { ...EMPTY_CANDIDATE_PROFILE.personal, ...(profile.personal ?? {}) },
    professional: { ...EMPTY_CANDIDATE_PROFILE.professional, ...(profile.professional ?? {}) },
    links: { ...EMPTY_CANDIDATE_PROFILE.links, ...(profile.links ?? {}) },
    preferences: { ...EMPTY_CANDIDATE_PROFILE.preferences, ...(profile.preferences ?? {}) },
    workAuthorization: {
      ...EMPTY_CANDIDATE_PROFILE.workAuthorization,
      ...(profile.workAuthorization ?? {}),
    },
    metadata: profile.metadata ?? EMPTY_CANDIDATE_PROFILE.metadata,
  });
}