import type { AutofillSettings } from '@schemas/application';
import { DEFAULT_AUTOFILL_SETTINGS } from '@schemas/application';
import type { AIConfig } from '@schemas/ai';

const SETTINGS_KEY = 'autofill_settings';
const AI_CONFIG_KEY = 'ai_config';

export async function getSettings(): Promise<AutofillSettings> {
  try {
    const result = await chrome.storage.sync.get(SETTINGS_KEY);
    return { ...DEFAULT_AUTOFILL_SETTINGS, ...(result[SETTINGS_KEY] ?? {}) };
  } catch {
    return DEFAULT_AUTOFILL_SETTINGS;
  }
}

export async function setSettings(settings: Partial<AutofillSettings>): Promise<AutofillSettings> {
  const current = await getSettings();
  const merged = { ...current, ...settings };
  await chrome.storage.sync.set({ [SETTINGS_KEY]: merged });
  return merged;
}

/**
 * Provider configuration can contain an API key, so it deliberately lives in
 * local storage. Autofill toggles above are harmless preferences and stay in
 * sync storage.
 */
export async function getAIConfig(): Promise<AIConfig | null> {
  try {
    const local = await chrome.storage.local.get(AI_CONFIG_KEY);
    if (local[AI_CONFIG_KEY]) return local[AI_CONFIG_KEY] as AIConfig;

    const legacy = await chrome.storage.sync.get(AI_CONFIG_KEY);
    const config = legacy[AI_CONFIG_KEY] as AIConfig | undefined;
    if (config) {
      await chrome.storage.local.set({ [AI_CONFIG_KEY]: config });
      await chrome.storage.sync.remove(AI_CONFIG_KEY);
      return config;
    }
    return null;
  } catch {
    return null;
  }
}

export async function setAIConfig(config: AIConfig): Promise<void> {
  await chrome.storage.local.set({ [AI_CONFIG_KEY]: config });
}

export async function clearAIConfig(): Promise<void> {
  await chrome.storage.local.remove(AI_CONFIG_KEY);
}
