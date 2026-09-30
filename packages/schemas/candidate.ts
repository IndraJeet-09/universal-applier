export interface PersonalInfo {
  fullName: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  email: string;
  phone?: string;
  location?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  address?: string;
  dateOfBirth?: string;
}

export interface ProfessionalInfo {
  headline?: string;
  summary?: string;
  yearsOfExperience?: number;
  currentRole?: string;
  currentCompany?: string;
  desiredRoles?: string[];
  preferredLocations?: string[];
  remotePreference?: 'remote' | 'hybrid' | 'onsite' | 'any';
  relocation?: boolean;
  noticePeriod?: string;
  salaryExpectation?: {
    min?: number;
    max?: number;
    currency?: string;
    period?: 'year' | 'month' | 'hour';
  };
}

export interface Education {
  id: string;
  institution: string;
  degree: string;
  fieldOfStudy?: string;
  graduationYear?: number;
  gpa?: string;
  location?: string;
  honors?: string[];
  startDate?: string;
  endDate?: string;
}

export interface Experience {
  id: string;
  company: string;
  title: string;
  location?: string;
  startDate: string;
  endDate?: string;
  current: boolean;
  description?: string;
  responsibilities?: string[];
  technologies?: string[];
  achievements?: string[];
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  technologies?: string[];
  url?: string;
  githubUrl?: string;
  startDate?: string;
  endDate?: string;
  highlights?: string[];
}

export interface Certification {
  id: string;
  name: string;
  issuer?: string;
  issueDate?: string;
  expiryDate?: string;
  credentialId?: string;
  url?: string;
}

export interface Skills {
  programmingLanguages: string[];
  frameworks: string[];
  databases: string[];
  cloud: string[];
  devops: string[];
  tools: string[];
  other: string[];
}

export function flattenSkills(skills: Skills | null | undefined): string[] {
  if (!skills) return [];
  return [
    ...(skills.programmingLanguages ?? []),
    ...(skills.frameworks ?? []),
    ...(skills.databases ?? []),
    ...(skills.cloud ?? []),
    ...(skills.devops ?? []),
    ...(skills.tools ?? []),
    ...(skills.other ?? []),
  ];
}

export interface Links {
  github?: string;
  linkedin?: string;
  portfolio?: string;
  twitter?: string;
  website?: string;
  other?: string[];
}

export type CapabilitySource = 'resume' | 'project' | 'experience' | 'education' | 'user';

export interface CapabilityEvidence {
  source: CapabilitySource;
  reference?: string;
  description?: string;
}

export interface CandidateCapability {
  name: string;
  category: string;
  evidence: CapabilityEvidence[];
  confidence: number;
}

export interface ApplicationAnswer {
  id: string;
  question: string;
  answer: string;
  tags?: string[];
  scope: 'global' | 'company' | 'role';
  createdAt: string;
  updatedAt: string;
}

export interface WorkAuthorization {
  authorizedToWork?: boolean;
  requiresSponsorship?: boolean;
  visaStatus?: string;
  citizenship?: string[];
  workPermitExpiry?: string;
}

export interface CandidateProfile {
  personal: PersonalInfo;
  professional: ProfessionalInfo;
  education: Education[];
  experience: Experience[];
  projects: Project[];
  skills: Skills;
  capabilities: CandidateCapability[];
  certifications: Certification[];
  links: Links;
  preferences: {
    desiredRoles?: string[];
    preferredLocations?: string[];
    remotePreference?: string;
    relocation?: boolean;
  };
  applicationAnswers: ApplicationAnswer[];
  workAuthorization: WorkAuthorization;
  metadata: {
    source: 'resume' | 'manual' | 'imported';
    parsedAt: string;
    version: number;
  };
}

export type CandidateProfilePartial = Partial<CandidateProfile>;

export const EMPTY_CANDIDATE_PROFILE: CandidateProfile = {
  personal: {
    fullName: '',
    email: '',
  },
  professional: {},
  education: [],
  experience: [],
  projects: [],
  skills: {
    programmingLanguages: [],
    frameworks: [],
    databases: [],
    cloud: [],
    devops: [],
    tools: [],
    other: [],
  },
  capabilities: [],
  certifications: [],
  links: {},
  preferences: {},
  applicationAnswers: [],
  workAuthorization: {},
  metadata: {
    source: 'manual',
    parsedAt: new Date().toISOString(),
    version: 1,
  },
};