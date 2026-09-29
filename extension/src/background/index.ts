import type { CandidateProfile } from '@schemas/candidate';
import type { SemanticField, FormAnalysis, FieldClassification } from '@schemas/dom';
import type { AutofillResult, FieldMapping } from '@schemas/application';
import { getCandidateProfile, setCandidateProfile } from './storage/candidateStore';
import { getSettings } from './storage/settingsStore';

interface MessageMap {
  'get-profile': { response: CandidateProfile };
  'set-profile': { payload: CandidateProfile; response: void };
  'analyze-form': { response: FormAnalysis };
  'classify-fields': { payload: SemanticField[]; response: FieldClassification[] };
  'fill-form': { payload: FieldMapping[]; response: AutofillResult };
  'get-settings': { response: AutofillSettings };
  'set-settings': { payload: Partial<AutofillSettings>; response: AutofillSettings };
  'ping': { response: { status: string } };
}

type MessageType = keyof MessageMap;
type MessagePayload<T extends MessageType> = MessageMap[T] extends { payload: infer P } ? P : never;
type MessageResponse<T extends MessageType> = MessageMap[T]['response'];

interface ExtensionMessage<T extends MessageType> {
  type: T;
  payload?: MessagePayload<T>;
  requestId: string;
}

interface ExtensionResponse<T> {
  requestId: string;
  success: boolean;
  data?: T;
  error?: string;
}

const pendingRequests = new Map<string, { resolve: (value: unknown) => void; reject: (reason: unknown) => void }>();

chrome.runtime.onMessage.addListener((message: ExtensionMessage<MessageType>, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((data) => sendResponse({ requestId: message.requestId, success: true, data }))
    .catch((error) => sendResponse({ requestId: message.requestId, success: false, error: error.message }));
  return true;
});

async function handleMessage<T extends MessageType>(message: ExtensionMessage<T>, sender: chrome.runtime.MessageSender): Promise<MessageResponse<T>> {
  switch (message.type) {
    case 'ping':
      return { status: 'ok' } as MessageResponse<T>;
    case 'get-profile':
      return await getCandidateProfile() as MessageResponse<T>;
    case 'set-profile':
      await setCandidateProfile(message.payload as CandidateProfile);
      return undefined as MessageResponse<T>;
    case 'get-settings':
      return await getSettings() as MessageResponse<T>;
    case 'set-settings':
      return await setSettings(message.payload) as MessageResponse<T>;
    case 'analyze-form':
      return await analyzeForm(sender.tab?.id) as MessageResponse<T>;
    case 'classify-fields':
      return await classifyFields(message.payload as SemanticField[]) as MessageResponse<T>;
    case 'fill-form':
      return await fillForm(message.payload as FieldMapping[], sender.tab?.id) as MessageResponse<T>;
    default:
      throw new Error(`Unknown message type: ${(message as ExtensionMessage<string>).type}`);
  }
}

async function analyzeForm(tabId?: number): Promise<FormAnalysis> {
  return {
    url: '',
    timestamp: new Date().toISOString(),
    formType: 'unknown',
    isJobApplication: false,
    sections: [],
    totalFields: 0,
    fillableFields: 0,
    highConfidenceFields: 0,
    needsReviewFields: 0,
    fingerprint: '',
  };
}

async function classifyFields(fields: SemanticField[]): Promise<FieldClassification[]> {
  return fields.map(field => ({
    fieldId: field.id,
    semanticField: 'unknown',
    category: 'unknown',
    confidence: 0,
    reason: 'Not implemented yet',
    method: 'deterministic' as const,
  }));
}

async function fillForm(mappings: FieldMapping[], tabId?: number): Promise<AutofillResult> {
  return {
    success: false,
    filledCount: 0,
    failedCount: 0,
    skippedCount: 0,
    needsReviewCount: 0,
    fields: [],
    errors: ['Not implemented yet'],
  };
}

async function setSettings(settings: Partial<AutofillSettings>): Promise<AutofillSettings> {
  const { setSettings: setSettingsStore } = await import('./storage/settingsStore');
  return await setSettingsStore(settings);
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('Universal Job Autofill installed');
});

console.log('Background service worker started');