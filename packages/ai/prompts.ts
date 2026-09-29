import type {
  FieldClassificationInput,
  AnswerGenerationInput,
  QuestionAnalysisInput,
} from '@schemas/ai';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export const SYSTEM_PROMPT = [
  'You are a form-intelligence component of a job-application autofill extension that runs locally in the user\'s browser.',
  'You receive structured input and must respond with a single raw JSON object — no markdown fences, no prose outside JSON.',
  'Ground rules:',
  '- Never invent facts about the candidate. The provided profile is the only allowed source of personal information.',
  '- If the evidence is insufficient, lower the confidence and state the gap in the reason/reasoning field.',
  '- confidence is a number between 0 and 1 reflecting certainty of your output, not importance.',
].join('\n');

function stringify(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function buildClassifyMessages(input: FieldClassificationInput): ChatMessage[] {
  const allowedKeys = input.knownFields?.length
    ? `\nPreferred semanticField keys (use one if any fits): ${input.knownFields.join(', ')}`
    : '\nUse a concise snake_case semanticField key describing what the field asks for.';

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        'Classify this web form field.',
        '',
        `Field:\n${stringify(input.field)}`,
        input.jobContext ? `\nJob context:\n${stringify(input.jobContext)}` : '',
        `\nCandidate profile (use only to disambiguate what the field asks for):\n${stringify(input.candidateProfile)}`,
        allowedKeys,
        '',
        'Respond with JSON exactly in this shape:',
        '{"semanticField": string, "category": string, "confidence": number, "reason": string}',
        `category must be one of: identity, location, professional, education, experience, skills, application, work_authorization, preferences, demographic, file_upload, custom_question, unknown.`,
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ];
}

export function buildAnalyzeQuestionMessages(input: QuestionAnalysisInput): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        'Analyze this job application question.',
        '',
        `Question: ${input.question}`,
        input.context ? `Surrounding context: ${input.context}` : '',
        '',
        'Respond with JSON exactly in this shape:',
        '{"type": string, "category": string, "intent": string, "requiresPersonalInfo": boolean, "sensitivity": "low" | "medium" | "high"}',
        `type must be one of: company_motivation, role_motivation, experience_summary, project_description, technical_challenge, career_goals, behavioral, culture_fit, leadership, salary_expectation, availability, work_authorization, custom.`,
        'sensitivity is high for legal commitments, protected-class/demographic questions, work authorization, and financial details.',
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ];
}

export function buildAnswerMessages(input: AnswerGenerationInput): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        'Write an answer to this job application question for the candidate.',
        '',
        `Question (type: ${input.questionType}): ${input.question}`,
        input.jobContext?.title || input.jobContext?.company
          ? `Job: ${input.jobContext?.title ?? 'unknown role'} at ${input.jobContext?.company ?? 'unknown company'}`
          : '',
        input.jobContext?.description ? `Job description:\n${input.jobContext.description}` : '',
        input.companyContext ? `Company context: ${input.companyContext}` : '',
        '',
        `Candidate profile (authoritative, the only allowed source of personal facts):\n${stringify(input.candidateProfile)}`,
        '',
        'Rules:',
        '- Answer in first person, as the candidate.',
        '- Stay under 150 words unless the question explicitly asks for more detail.',
        '- groundedFacts must list each profile fact you relied on, quoted or closely paraphrased.',
        '- If the profile lacks relevant information, set groundedFacts to ["insufficient profile data"] and confidence to at most 0.3.',
        '- Never fabricate employers, dates, degrees, metrics, or experiences.',
        '',
        'Respond with JSON exactly in this shape:',
        '{"answer": string, "confidence": number, "reasoning": string, "groundedFacts": string[]}',
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ];
}
