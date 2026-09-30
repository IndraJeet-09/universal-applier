import type { CandidateProfile } from '@schemas/candidate';
import { EMPTY_CANDIDATE_PROFILE } from '@schemas/candidate';

const CANDIDATE_KEY = 'candidate_profile';
const STORAGE_VERSION = 1;

export async function getCandidateProfile(): Promise<CandidateProfile> {
  try {
    const result = await chrome.storage.local.get(CANDIDATE_KEY);
    const data = result[CANDIDATE_KEY];
    if (data && data.version === STORAGE_VERSION) {
      return hydrateProfile(data as Partial<CandidateProfile>);
    }
    return EMPTY_CANDIDATE_PROFILE;
  } catch {
    return EMPTY_CANDIDATE_PROFILE;
  }
}

function hydrateProfile(data: Partial<CandidateProfile>): CandidateProfile {
  return {
    ...EMPTY_CANDIDATE_PROFILE,
    ...data,
    personal: { ...EMPTY_CANDIDATE_PROFILE.personal, ...(data.personal ?? {}) },
    skills: { ...EMPTY_CANDIDATE_PROFILE.skills, ...(data.skills ?? {}) },
    capabilities: data.capabilities ?? [],
    education: data.education ?? [],
    experience: data.experience ?? [],
    projects: data.projects ?? [],
    certifications: data.certifications ?? [],
    applicationAnswers: data.applicationAnswers ?? [],
    metadata: { ...EMPTY_CANDIDATE_PROFILE.metadata, ...(data.metadata ?? {}) },
  };
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
  const merged = deepMerge(current, updates) as CandidateProfile;
  await setCandidateProfile(merged);
  return merged;
}

export async function clearCandidateProfile(): Promise<void> {
  await chrome.storage.local.remove(CANDIDATE_KEY);
}

function deepMerge(target: unknown, source: unknown): unknown {
  if (!isPlainObject(target) || !isPlainObject(source)) return source;
  const result: Record<string, unknown> = { ...target };
  for (const key of Object.keys(source)) {
    result[key] = key in result ? deepMerge(result[key], source[key]) : source[key];
  }
  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
