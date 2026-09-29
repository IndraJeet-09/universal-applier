import { z } from 'zod';

export const QUESTION_TYPES = [
  'company_motivation',
  'role_motivation',
  'experience_summary',
  'project_description',
  'technical_challenge',
  'career_goals',
  'behavioral',
  'culture_fit',
  'leadership',
  'salary_expectation',
  'availability',
  'work_authorization',
  'custom',
] as const;

export const FIELD_CATEGORIES = [
  'identity',
  'location',
  'professional',
  'education',
  'experience',
  'skills',
  'application',
  'work_authorization',
  'preferences',
  'demographic',
  'file_upload',
  'custom_question',
  'unknown',
] as const;

export const fieldClassificationOutputSchema = z.object({
  semanticField: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z][a-z0-9_]*$/, 'semanticField must be snake_case'),
  category: z.enum(FIELD_CATEGORIES),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(400),
});

export const questionAnalysisOutputSchema = z.object({
  type: z.enum(QUESTION_TYPES),
  category: z.string().min(1).max(80),
  intent: z.string().min(1).max(400),
  requiresPersonalInfo: z.boolean(),
  sensitivity: z.enum(['low', 'medium', 'high']),
});

export const answerGenerationOutputSchema = z.object({
  answer: z.string().min(1).max(6000),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(1).max(600),
  groundedFacts: z.array(z.string().min(1).max(500)).min(1).max(30),
});

export type FieldClassificationOutputParsed = z.infer<typeof fieldClassificationOutputSchema>;
export type QuestionAnalysisOutputParsed = z.infer<typeof questionAnalysisOutputSchema>;
export type AnswerGenerationOutputParsed = z.infer<typeof answerGenerationOutputSchema>;
