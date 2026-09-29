import type { CandidateProfile, EMPTY_CANDIDATE_PROFILE } from '@schemas/candidate';

const CANDIDATE_KEY = 'candidate_profile';
const STORAGE_VERSION = 1;

export async function getCandidateProfile(): Promise<CandidateProfile> {
  try {
    const result = await chrome.storage.local.get(CANDIDATE_KEY);
    const data = result[CANDIDATE_KEY];
    if (data && data.version === STORAGE_VERSION) {
      return data as CandidateProfile;
    }
    return EMPTY_CANDIDATE_PROFILE;
  } catch {
    return EMPTY_CANDIDATE_PROFILE;
  }
}

export async function setCandidateProfile(profile: CandidateProfile): Promise<void> {
  const data = {
    ...profile,
    version: STORAGE_VERSION,
    metadata: {
      ...profile.metadata,
      version: STORAGE_VERSION,
    },
  };
  await chrome.storage.local.set({ [CANDIDATE_KEY]: data });
}

export async function updateCandidateProfile(updates: Partial<CandidateProfile>): Promise<CandidateProfile> {
  const current = await getCandidateProfile();
  const merged = deepMerge(current, updates);
  await setCandidateProfile(merged);
  return merged;
}

export async function clearCandidateProfile(): Promise<void> {
  await chrome.storage.local.remove(CANDIDATE_KEY);
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const sourceValue = source[key];
    const targetValue = target[key];
    if (isObject(sourceValue) && isObject(targetValue)) {
      result[key] = deepMerge(targetValue as Record<string, unknown>, sourceValue as Record<string, unknown>);
    } else {
      result[key] = sourceValue;
    }
  }
  return result;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function addApplicationAnswer(
  question: string,
  answer: string,
  tags?: string[],
  scope: 'global' | 'company' | 'role' = 'global'
): Promise<void> {
  const profile = await getCandidateProfile();
  const newAnswer = {
    id: crypto.randomUUID(),
    question,
    answer,
    tags,
    scope,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  profile.applicationAnswers.push(newAnswer);
  await setCandidateProfile(profile);
}

export async function getApplicationAnswers(): Promise<CandidateProfile['applicationAnswers']> {
  const profile = await getCandidateProfile();
  return profile.applicationAnswers;
}

export async function findMatchingAnswer(question: string, threshold = 0.8): Promise<CandidateProfile['applicationAnswers'][0] | null> {
  const answers = await getApplicationAnswers();
  const normalizedQuestion = question.toLowerCase().trim();
  for (const ans of answers) {
    const normalizedAns = ans.question.toLowerCase().trim();
    const similarity = calculateSimilarity(normalizedQuestion, normalizedAns);
    if (similarity >= threshold) {
      return ans;
    }
  }
  return null;
}

function calculateSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.split(/\s+/));
  const wordsB = new Set(b.split(/\s+/));
  const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
  const union = new Set([...wordsA, ...wordsB]);
  return intersection.size / union.size;
}