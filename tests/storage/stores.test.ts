import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_CANDIDATE_PROFILE } from '@schemas/candidate';
import { DEFAULT_AUTOFILL_SETTINGS } from '@schemas/application';
import * as candidateStore from '../../extension/src/storage/candidateStore';
import * as resumeStore from '../../extension/src/storage/resumeStore';
import * as settingsStore from '../../extension/src/storage/settingsStore';
import * as answerStore from '../../extension/src/storage/answerStore';

type GetKeys = string | string[] | Record<string, unknown> | null | undefined;

interface StorageArea {
  data: Record<string, unknown>;
  get(keys?: GetKeys): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

function createArea(): StorageArea {
  const data: Record<string, unknown> = {};
  return {
    data,
    async get(keys) {
      if (keys == null) return { ...data };
      if (typeof keys === 'string') {
        return keys in data ? { [keys]: data[keys] } : {};
      }
      if (Array.isArray(keys)) {
        return Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]]));
      }
      return Object.fromEntries(
        Object.entries(keys).map(([k, fallback]) => [k, k in data ? data[k] : fallback])
      );
    },
    async set(items) {
      Object.assign(data, items);
    },
    async remove(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
    },
  };
}

const local = createArea();
const sync = createArea();

vi.stubGlobal('chrome', { storage: { local, sync } });

beforeEach(async () => {
  await local.remove(Object.keys(local.data));
  await sync.remove(Object.keys(sync.data));
});

describe('candidateStore', () => {
  it('returns the empty profile when nothing is stored', async () => {
    const profile = await candidateStore.getCandidateProfile();
    expect(profile.personal.fullName).toBe('');
    expect(profile.skills.devops).toEqual([]);
    expect(profile.capabilities).toEqual([]);
  });

  it('round-trips a saved profile', async () => {
    const profile = {
      ...EMPTY_CANDIDATE_PROFILE,
      personal: { fullName: 'Indrajeet Chouhan', email: 'indrajeet@example-dev.io' },
      metadata: { ...EMPTY_CANDIDATE_PROFILE.metadata, source: 'resume' as const },
    };
    await candidateStore.setCandidateProfile(profile);

    const loaded = await candidateStore.getCandidateProfile();
    expect(loaded.personal.fullName).toBe('Indrajeet Chouhan');
    expect(loaded.personal.email).toBe('indrajeet@example-dev.io');
    expect(loaded.metadata.source).toBe('resume');
  });

  it('hydrates profiles stored by older versions', async () => {
    await local.set({
      candidate_profile: {
        version: 1,
        personal: { fullName: 'Legacy User', email: 'legacy@example-dev.io' },
      },
    });

    const loaded = await candidateStore.getCandidateProfile();
    expect(loaded.personal.fullName).toBe('Legacy User');
    expect(loaded.skills).toEqual(EMPTY_CANDIDATE_PROFILE.skills);
    expect(loaded.capabilities).toEqual([]);
    expect(loaded.applicationAnswers).toEqual([]);
  });

  it('ignores data written by an unknown storage version', async () => {
    await local.set({ candidate_profile: { version: 99, personal: { fullName: 'Future' } } });
    const loaded = await candidateStore.getCandidateProfile();
    expect(loaded.personal.fullName).toBe('');
  });

  it('never hands out the shared empty-profile instance', async () => {
    const first = await candidateStore.getCandidateProfile();
    expect(first).not.toBe(EMPTY_CANDIDATE_PROFILE);

    first.personal.fullName = 'Mutated';
    first.links.github = 'https://github.com/mutated';

    const second = await candidateStore.getCandidateProfile();
    expect(second.personal.fullName).toBe('');
    expect(second.links.github).toBeUndefined();
    expect(EMPTY_CANDIDATE_PROFILE.personal.fullName).toBe('');
  });

  it('deep merges partial updates', async () => {
    await candidateStore.setCandidateProfile(EMPTY_CANDIDATE_PROFILE);
    await candidateStore.updateCandidateProfile({
      personal: { fullName: 'Indrajeet Chouhan', email: 'indrajeet@example-dev.io' },
    });

    const loaded = await candidateStore.getCandidateProfile();
    expect(loaded.personal.fullName).toBe('Indrajeet Chouhan');
    expect(loaded.personal.phone).toBeUndefined();

    await candidateStore.clearCandidateProfile();
    expect((await candidateStore.getCandidateProfile()).personal.fullName).toBe('');
  });
});

describe('resumeStore', () => {
  it('keeps the original file bytes untouched', async () => {
    const data = new TextEncoder().encode('original resume bytes').buffer as ArrayBuffer;
    await resumeStore.saveResumeFile({
      filename: 'resume.pdf',
      format: 'pdf',
      mimeType: 'application/pdf',
      data,
      size: data.byteLength,
      uploadedAt: new Date().toISOString(),
    });

    const loaded = await resumeStore.getResumeFile();
    expect(loaded?.filename).toBe('resume.pdf');
    expect(loaded?.format).toBe('pdf');
    expect(loaded?.data.byteLength).toBe(data.byteLength);
    expect(new TextDecoder().decode(loaded?.data)).toBe('original resume bytes');

    await resumeStore.clearResumeFile();
    expect(await resumeStore.getResumeFile()).toBeNull();
  });

  it('guesses mime types for each supported format', () => {
    expect(resumeStore.guessMimeType('resume.pdf', 'pdf')).toBe('application/pdf');
    expect(resumeStore.guessMimeType('resume.docx', 'docx')).toContain('wordprocessingml');
    expect(resumeStore.guessMimeType('resume.txt', 'txt')).toBe('text/plain');
    expect(resumeStore.guessMimeType('notes.md', 'txt')).toBe('text/markdown');
  });
});

describe('settingsStore', () => {
  it('falls back to defaults and merges partial updates', async () => {
    expect(await settingsStore.getSettings()).toEqual(DEFAULT_AUTOFILL_SETTINGS);

    const updated = await settingsStore.setSettings({ debugMode: true });
    expect(updated.debugMode).toBe(true);
    expect(updated.skipSensitiveFields).toBe(DEFAULT_AUTOFILL_SETTINGS.skipSensitiveFields);
  });

  it('keeps the AI provider config in local storage only', async () => {
    await settingsStore.setAIConfig({ provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o-mini' });

    expect(await settingsStore.getAIConfig()).toEqual({
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
    });
    expect(sync.data.ai_config).toBeUndefined();
    expect(local.data.ai_config).toBeDefined();

    await settingsStore.clearAIConfig();
    expect(await settingsStore.getAIConfig()).toBeNull();
  });

  it('migrates a legacy synced config out of sync storage', async () => {
    await sync.set({ ai_config: { provider: 'anthropic', apiKey: 'legacy-key', model: 'claude-3' } });

    const config = await settingsStore.getAIConfig();
    expect(config?.provider).toBe('anthropic');
    expect(sync.data.ai_config).toBeUndefined();
    expect(local.data.ai_config).toEqual(config);
  });
});

describe('answerStore', () => {
  it('adds, updates and removes answers on the profile', async () => {
    const added = await answerStore.addApplicationAnswer(
      'Why do you want to work here?',
      'I admire your developer tooling.',
      ['motivation'],
      'company'
    );
    expect(added.scope).toBe('company');

    const updated = await answerStore.updateApplicationAnswer(added.id, { answer: 'Edited' });
    expect(updated?.answer).toBe('Edited');

    const answers = await answerStore.getApplicationAnswers();
    expect(answers).toHaveLength(1);
    expect(answers[0].answer).toBe('Edited');

    expect(await answerStore.removeApplicationAnswer(added.id)).toBe(true);
    expect(await answerStore.getApplicationAnswers()).toHaveLength(0);
    expect(await answerStore.updateApplicationAnswer('missing', { answer: 'x' })).toBeNull();
  });

  it('reuses a saved answer for a similar question', async () => {
    await answerStore.addApplicationAnswer(
      'Why do you want to work here?',
      'I admire your developer tooling.'
    );

    const match = await answerStore.findMatchingAnswer('Why do you want to work here?');
    expect(match?.answer).toBe('I admire your developer tooling.');

    const miss = await answerStore.findMatchingAnswer('What is your favourite colour?');
    expect(miss).toBeNull();
  });
});
