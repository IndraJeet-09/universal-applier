export interface AIProvider {
  classifyField(input: FieldClassificationInput): Promise<FieldClassificationOutput>;
  generateAnswer(input: AnswerGenerationInput): Promise<AnswerGenerationOutput>;
  analyzeQuestion(input: QuestionAnalysisInput): Promise<QuestionAnalysisOutput>;
}

export interface FieldClassificationInput {
  field: {
    label?: string;
    placeholder?: string;
    name?: string;
    type?: string;
    options?: string[];
    surroundingText?: string;
    section?: string;
  };
  candidateProfile: {
    skills?: string[];
    links?: Record<string, string>;
    experience?: Array<{ title: string; company: string }>;
    education?: Array<{ degree: string; institution: string }>;
  };
}

export interface FieldClassificationOutput {
  semanticField: string;
  category: string;
  confidence: number;
  reason: string;
}

export interface AnswerGenerationInput {
  question: string;
  questionType: QuestionType;
  candidateProfile: {
    personal: { fullName: string; email: string; location?: string };
    professional: { headline?: string; summary?: string; yearsOfExperience?: number };
    experience: Array<{ title: string; company: string; description?: string; technologies?: string[] }>;
    education: Array<{ degree: string; institution: string; fieldOfStudy?: string }>;
    skills: string[];
    projects: Array<{ name: string; description?: string; technologies?: string[] }>;
    links: Record<string, string>;
  };
  jobContext?: {
    title?: string;
    company?: string;
    description?: string;
    requirements?: string[];
  };
  companyContext?: string;
}

export interface AnswerGenerationOutput {
  answer: string;
  confidence: number;
  reasoning: string;
  groundedFacts: string[];
}

export interface QuestionAnalysisInput {
  question: string;
  context?: string;
}

export interface QuestionAnalysisOutput {
  type: QuestionType;
  category: string;
  intent: string;
  requiresPersonalInfo: boolean;
  sensitivity: 'low' | 'medium' | 'high';
}

export type QuestionType =
  | 'company_motivation'
  | 'role_motivation'
  | 'experience_summary'
  | 'project_description'
  | 'technical_challenge'
  | 'career_goals'
  | 'behavioral'
  | 'culture_fit'
  | 'leadership'
  | 'salary_expectation'
  | 'availability'
  | 'work_authorization'
  | 'custom';

export interface AIConfig {
  provider: 'openai' | 'anthropic' | 'groq' | 'custom' | 'local';
  apiKey?: string;
  baseUrl?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
}

export interface CachedMapping {
  fingerprint: string;
  semanticField: string;
  category: string;
  confidence: number;
  timestamp: number;
  usageCount: number;
}