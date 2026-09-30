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
    return hydrateProfile({});
  } catch {
    return hydrateProfile({});
  }
}

/**
 * Always returns a fresh object: callers mutate the profile before saving it,
 * and the empty profile constant must never be shared by reference.
 */
function hydrateProfile(data: Partial<CandidateProfile>): CandidateProfile {
  const base = structuredClone(EMPTY_CANDIDATE_PROFILE);
  return {
    ...base,
    ...data,
    personal: { ...base.personal, ...(data.personal ?? {}) },
    professional: { ...base.professional, ...(data.professional ?? {}) },
    skills: { ...base.skills, ...(data.skills ?? {}) },
    links: { ...base.links, ...(data.links ?? {}) },
    preferences: { ...base.preferences, ...(data.preferences ?? {}) },
    workAuthorization: { ...base.workAuthorization, ...(data.workAuthorization ?? {}) },
    capabilities: data.capabilities ?? base.capabilities,
    education: data.education ?? base.education,
    experience: data.experience ?? base.experience,
    projects: data.projects ?? base.projects,
    certifications: data.certifications ?? base.certifications,
    applicationAnswers: data.applicationAnswers ?? base.applicationAnswers,
    metadata: { ...base.metadata, ...(data.metadata ?? {}) },
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
