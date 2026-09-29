import type { CandidateProfile } from '@schemas/candidate';
import type { AutofillSettings } from '@schemas/application';
import type { AIConfig } from '@schemas/ai';
import { DEFAULT_AUTOFILL_SETTINGS } from '@schemas/application';
import { registerHandlers } from '../utils/messaging';
import { createLogger, setDebugMode } from '../utils/logger';
import * as candidateStore from '../storage/candidateStore';
import * as settingsStore from '../storage/settingsStore';

const log = createLogger('background');

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