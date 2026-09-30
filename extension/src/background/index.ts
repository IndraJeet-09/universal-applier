import { flattenSkills, type CandidateProfile } from '@schemas/candidate';
import type { AutofillSettings } from '@schemas/application';
import type { AIConfig, FieldClassificationInput, FieldClassificationOutput } from '@schemas/ai';
import type { JobContext } from '@schemas/dom';
import { DEFAULT_AUTOFILL_SETTINGS } from '@schemas/application';
import { createProvider, createCachedProvider, type CachedAIProvider, AIError } from '@ai/index';
import { registerHandlers } from '../utils/messaging';
import { createLogger, setDebugMode } from '../utils/logger';
import * as candidateStore from '../storage/candidateStore';
import * as settingsStore from '../storage/settingsStore';
import { buildAnswerInput, linksToRecord } from '../intelligence/answerGenerator';
import { SYNONYMS } from '../intelligence/taxonomy';

const log = createLogger('background');

let providerCache: { key: string; provider: CachedAIProvider } | null = null;

function getProvider(config: AIConfig): CachedAIProvider {
  const key = JSON.stringify(config);
  if (!providerCache || providerCache.key !== key) {
    providerCache = { key, provider: createCachedProvider(createProvider(config)) };
  }
  return providerCache.provider;
}

async function withProvider<T>(
  run: (provider: CachedAIProvider, profile: CandidateProfile) => Promise<T>
): Promise<T | null> {
  const config = await settingsStore.getAIConfig();
  if (!config) return null;
  try {
    const provider = getProvider(config);
    const profile = await candidateStore.getCandidateProfile();
    return await run(provider, profile);
  } catch (err) {
    if (err instanceof AIError) {
      log.warn('AI request failed', { code: err.code, message: err.message });
    } else {
      log.warn('AI request failed', { message: String(err) });
    }
    return null;
  }
}

const handlers = {
  async 'content-ping'(): Promise<{ hasContentScript: boolean }> {
    return { hasContentScript: true };
  },

  async 'ping'(): Promise<{ status: string; version: string }> {
    return { status: 'ok', version: chrome.runtime.getManifest().version };
  },

  async 'get-profile'(): Promise<CandidateProfile> {
    return candidateStore.getCandidateProfile();
  },

  async 'set-profile'(payload: CandidateProfile): Promise<void> {
    await candidateStore.setCandidateProfile(payload);
  },

  async 'get-settings'(): Promise<AutofillSettings> {
    const settings = await settingsStore.getSettings();
    setDebugMode(settings.debugMode);
    return settings;
  },

  async 'set-settings'(payload: Partial<AutofillSettings>): Promise<AutofillSettings> {
    const settings = await settingsStore.setSettings(payload);
    setDebugMode(settings.debugMode);
    return settings;
  },

  async 'get-ai-config'(): Promise<AIConfig | null> {
    return settingsStore.getAIConfig();
  },

  async 'set-ai-config'(payload: AIConfig): Promise<void> {
    await settingsStore.setAIConfig(payload);
  },

  async 'content-fields-updated'(payload: { count: number }): Promise<void> {
    log.debug('content script reported field changes', payload);
  },

  async 'ai-classify'(payload: {
    field: FieldClassificationInput['field'];
    jobContext?: JobContext;
  }): Promise<FieldClassificationOutput | null> {
    return withProvider(async (provider, profile) =>
      provider.classifyField({
        field: payload.field,
        candidateProfile: {
          skills: flattenSkills(profile.skills),
          links: linksToRecord(profile.links),
          experience: profile.experience.map((e) => ({ title: e.title, company: e.company })),
          education: profile.education.map((e) => ({ degree: e.degree, institution: e.institution })),
        },
        knownFields: Object.keys(SYNONYMS),
        ...(payload.jobContext
          ? { jobContext: { title: payload.jobContext.title, company: payload.jobContext.company } }
          : {}),
      })
    );
  },

  async 'ai-answer'(payload: {
    question: string;
    semanticField: string;
    category: string;
    jobContext?: JobContext;
  }): Promise<{ answer: string; confidence: number } | null> {
    return withProvider(async (provider, profile) => {
      const input = buildAnswerInput(
        profile,
        {
          question: payload.question,
          semanticField: payload.semanticField,
          category: payload.category,
        },
        payload.jobContext
      );
      const result = await provider.generateAnswer(input);
      return { answer: result.answer, confidence: result.confidence };
    });
  },
};

registerHandlers(handlers);

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await settingsStore.getSettings();
  setDebugMode(settings.debugMode);
  log.info('extension installed', { version: chrome.runtime.getManifest().version });
});

log.info('background service worker started', {
  defaults: DEFAULT_AUTOFILL_SETTINGS,
});