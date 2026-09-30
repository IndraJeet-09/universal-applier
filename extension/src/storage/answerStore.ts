import type { ApplicationAnswer } from '@schemas/candidate';
import { getCandidateProfile, setCandidateProfile } from './candidateStore';

export type AnswerScope = ApplicationAnswer['scope'];

export async function getApplicationAnswers(): Promise<ApplicationAnswer[]> {
  const profile = await getCandidateProfile();
  return profile.applicationAnswers;
}

export async function addApplicationAnswer(
  question: string,
  answer: string,
  tags?: string[],
  scope: AnswerScope = 'global'
): Promise<ApplicationAnswer> {
  const profile = await getCandidateProfile();
  const now = new Date().toISOString();
  const stored: ApplicationAnswer = {
    id: crypto.randomUUID(),
    question,
    answer,
    tags,
    scope,
    createdAt: now,
    updatedAt: now,
  };
  profile.applicationAnswers.push(stored);
  await setCandidateProfile(profile);
  return stored;
}

export async function updateApplicationAnswer(
  id: string,
  patch: Partial<Pick<ApplicationAnswer, 'question' | 'answer' | 'tags' | 'scope'>>
): Promise<ApplicationAnswer | null> {
  const profile = await getCandidateProfile();
  const existing = profile.applicationAnswers.find((a) => a.id === id);
  if (!existing) return null;
  Object.assign(existing, patch, { updatedAt: new Date().toISOString() });
  await setCandidateProfile(profile);
  return existing;
}

export async function removeApplicationAnswer(id: string): Promise<boolean> {
  const profile = await getCandidateProfile();
  const before = profile.applicationAnswers.length;
  profile.applicationAnswers = profile.applicationAnswers.filter((a) => a.id !== id);
  if (profile.applicationAnswers.length === before) return false;
  await setCandidateProfile(profile);
  return true;
}

export async function findMatchingAnswer(
  question: string,
  threshold = 0.8
): Promise<ApplicationAnswer | null> {
  const answers = await getApplicationAnswers();
  const normalizedQuestion = question.toLowerCase().trim();
  for (const answer of answers) {
    const similarity = calculateSimilarity(normalizedQuestion, answer.question.toLowerCase().trim());
    if (similarity >= threshold) return answer;
  }
  return null;
}

function calculateSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.split(/\s+/));
  const wordsB = new Set(b.split(/\s+/));
  const intersection = new Set([...wordsA].filter((x) => wordsB.has(x)));
  const union = new Set([...wordsA, ...wordsB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}
