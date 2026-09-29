import type { AutofillSettings, DEFAULT_AUTOFILL_SETTINGS, AIConfig } from '@schemas/application';

const SETTINGS_KEY = 'autofill_settings';
const AI_CONFIG_KEY = 'ai_config';

export async function getSettings(): Promise<AutofillSettings> {
  try {
    const result = await chrome.storage.sync.get(SETTINGS_KEY);
    return result[SETTINGS_KEY] || DEFAULT_AUTOFILL_SETTINGS;
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

export async function getAIConfig(): Promise<AIConfig | null> {
  try {
    const result = await chrome.storage.sync.get(AI_CONFIG_KEY);
    return result[AI_CONFIG_KEY] || null;
  } catch {
    return null;
  }
}

export async function setAIConfig(config: AIConfig): Promise<void> {
  await chrome.storage.sync.set({ [AI_CONFIG_KEY]: config });
}

export async function clearAIConfig(): Promise<void> {
  await chrome.storage.sync.remove(AI_CONFIG_KEY);
}