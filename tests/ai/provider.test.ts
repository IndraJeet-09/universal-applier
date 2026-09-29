// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createProvider,
  createCachedProvider,
  AIError,
  MAX_AI_CONFIDENCE,
} from '@ai/index';
import type { AIConfig, AIProvider, FieldClassificationInput } from '@schemas/ai';

const FIELD_INPUT: FieldClassificationInput = {
  field: { label: 'Email address', placeholder: 'you@example.com', type: 'email' },
  candidateProfile: { skills: ['TypeScript'], links: {} },
  knownFields: ['email', 'phone', 'full_name'],
};

function openaiConfig(overrides: Partial<AIConfig> = {}): AIConfig {
  return { provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o-mini', ...overrides };
}

interface FakeResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

function openaiResponse(content: unknown): FakeResponse {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: text } }] }),
    text: async () => text,
  };
}

function errorResponse(status: number, body: string): FakeResponse {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => body,
  };
}

function anthropicResponse(text: string): FakeResponse {
  return {
    ok: true,
    status: 200,
    json: async () => ({ content: [{ type: 'text', text }] }),
    text: async () => text,
  };
}

const VALID_CLASSIFICATION = {
  semanticField: 'email',
  category: 'identity',
  confidence: 0.97,
  reason: 'field asks for an email address',
};

const VALID_ANALYSIS = {
  type: 'company_motivation',
  category: 'application',
  intent: 'why the candidate wants to join this company',
  requiresPersonalInfo: false,
  sensitivity: 'low',
};

const VALID_ANSWER = {
  answer: 'I am excited about this role because of the team focus on accessible tooling.',
  confidence: 0.8,
  reasoning: 'drawn from the candidate profile summary',
  groundedFacts: ['summary: builds accessible developer tooling'],
};

function answerInput(): Parameters<AIProvider['generateAnswer']>[0] {
  return {
    question: 'Why do you want to work here?',
    questionType: 'company_motivation',
    candidateProfile: {
      personal: { fullName: 'John Doe', email: 'john@example.com' },
      professional: { headline: 'Engineer', summary: 'builds accessible developer tooling' },
      experience: [],
      education: [],
      skills: ['TypeScript'],
      projects: [],
      links: {},
    },
  };
}

describe('createProvider factory', () => {
  it('creates an openai-compatible provider', () => {
    expect(createProvider(openaiConfig())).toBeDefined();
  });

  it('throws no_api_key when openai key is missing', () => {
    let caught: unknown;
    try {
      createProvider(openaiConfig({ apiKey: undefined }));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AIError);
    expect((caught as AIError).code).toBe('no_api_key');
  });

  it('throws disabled for the local provider', () => {
    let caught: unknown;
    try {
      createProvider({ provider: 'local', model: 'llama' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AIError);
    expect((caught as AIError).code).toBe('disabled');
  });

  it('allows custom provider without an api key', () => {
    const provider = createProvider({
      provider: 'custom',
      baseUrl: 'http://localhost:11434/v1/chat/completions',
      model: 'qwen',
    });
    expect(provider).toBeDefined();
  });
});

describe('OpenAICompatibleProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('classifies a field with a validated response', async () => {
    fetchMock.mockResolvedValue(openaiResponse(VALID_CLASSIFICATION));
    const provider = createProvider(openaiConfig());

    const result = await provider.classifyField(FIELD_INPUT);

    expect(result.semanticField).toBe('email');
    expect(result.category).toBe('identity');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(JSON.stringify(body.messages)).toContain('you@example.com');
    expect(JSON.stringify(body.messages)).toContain('email, phone, full_name');
  });

  it('caps AI confidence below the auto-fill threshold', async () => {
    fetchMock.mockResolvedValue(openaiResponse({ ...VALID_CLASSIFICATION, confidence: 0.99 }));
    const provider = createProvider(openaiConfig());
    const result = await provider.classifyField(FIELD_INPUT);
    expect(result.confidence).toBe(MAX_AI_CONFIDENCE);
  });

  it('extracts JSON even when wrapped in markdown fences', async () => {
    fetchMock.mockResolvedValue(
      openaiResponse('```json\n' + JSON.stringify(VALID_CLASSIFICATION) + '\n```')
    );
    const provider = createProvider(openaiConfig());
    const result = await provider.classifyField(FIELD_INPUT);
    expect(result.semanticField).toBe('email');
  });

  it('retries once with a repair prompt on invalid JSON, then throws', async () => {
    fetchMock
      .mockResolvedValueOnce(openaiResponse('I think this field is an email address.'))
      .mockResolvedValueOnce(openaiResponse('Still not JSON, sorry.'));

    const provider = createProvider(openaiConfig());
    await expect(provider.classifyField(FIELD_INPUT)).rejects.toMatchObject({
      code: 'invalid_response',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [, secondInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const secondBody = JSON.parse(String(secondInit.body));
    expect(JSON.stringify(secondBody.messages)).toContain('invalid');
  });

  it('accepts a repaired response on the retry', async () => {
    fetchMock
      .mockResolvedValueOnce(openaiResponse('not json'))
      .mockResolvedValueOnce(openaiResponse(VALID_CLASSIFICATION));

    const provider = createProvider(openaiConfig());
    const result = await provider.classifyField(FIELD_INPUT);
    expect(result.semanticField).toBe('email');
  });

  it('maps HTTP 429 to rate_limited', async () => {
    fetchMock.mockResolvedValue(errorResponse(429, 'slow down'));
    const provider = createProvider(openaiConfig());
    await expect(provider.classifyField(FIELD_INPUT)).rejects.toMatchObject({
      code: 'rate_limited',
    });
  });

  it('maps network failures to a typed error', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const provider = createProvider(openaiConfig());
    await expect(provider.classifyField(FIELD_INPUT)).rejects.toMatchObject({
      code: 'network',
    });
  });

  it('maps abort errors to timeout', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    fetchMock.mockRejectedValue(abortError);
    const provider = createProvider(openaiConfig());
    await expect(provider.classifyField(FIELD_INPUT)).rejects.toMatchObject({
      code: 'timeout',
    });
  });

  it('analyzes questions', async () => {
    fetchMock.mockResolvedValue(openaiResponse(VALID_ANALYSIS));
    const provider = createProvider(openaiConfig());
    const result = await provider.analyzeQuestion({
      question: 'Why do you want to join Acme?',
    });
    expect(result.type).toBe('company_motivation');
    expect(result.sensitivity).toBe('low');
  });

  it('generates grounded answers and caps confidence', async () => {
    fetchMock.mockResolvedValue(openaiResponse({ ...VALID_ANSWER, confidence: 0.99 }));
    const provider = createProvider(openaiConfig());
    const result = await provider.generateAnswer(answerInput());
    expect(result.groundedFacts.length).toBeGreaterThan(0);
    expect(result.confidence).toBe(MAX_AI_CONFIDENCE);
  });

  it('rejects answers without grounded facts', async () => {
    fetchMock
      .mockResolvedValueOnce(openaiResponse({ ...VALID_ANSWER, groundedFacts: [] }))
      .mockResolvedValueOnce(openaiResponse({ ...VALID_ANSWER, groundedFacts: [] }));
    const provider = createProvider(openaiConfig());
    await expect(provider.generateAnswer(answerInput())).rejects.toMatchObject({
      code: 'invalid_response',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid semanticField keys during validation', async () => {
    fetchMock
      .mockResolvedValueOnce(openaiResponse({ ...VALID_CLASSIFICATION, semanticField: 'Email Address!' }))
      .mockResolvedValueOnce(openaiResponse({ ...VALID_CLASSIFICATION, semanticField: 'Email Address!' }));
    const provider = createProvider(openaiConfig());
    await expect(provider.classifyField(FIELD_INPUT)).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });
});

describe('AnthropicProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the anthropic messages request shape', async () => {
    fetchMock.mockResolvedValue(anthropicResponse(JSON.stringify(VALID_CLASSIFICATION)));
    const provider = createProvider({
      provider: 'anthropic',
      apiKey: 'sk-ant-test',
      model: 'claude-sonnet-4-5',
    });

    await provider.classifyField(FIELD_INPUT);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(String(init.body));
    expect(body.system).toContain('JSON object');
    expect(Array.isArray(body.messages)).toBe(true);
    expect(body.messages[0].role).toBe('user');
  });

  it('throws no_api_key without a key', () => {
    let caught: unknown;
    try {
      createProvider({ provider: 'anthropic', apiKey: undefined, model: 'claude' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AIError);
    expect((caught as AIError).code).toBe('no_api_key');
  });
});

describe('createCachedProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('serves repeated classifications from cache', async () => {
    fetchMock.mockResolvedValue(openaiResponse(VALID_CLASSIFICATION));
    const cached = createCachedProvider(createProvider(openaiConfig()));

    await cached.classifyField(FIELD_INPUT);
    await cached.classifyField(FIELD_INPUT);
    await cached.classifyField(FIELD_INPUT);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cached.cacheSize()).toBe(1);

    cached.clearCache();
    await cached.classifyField(FIELD_INPUT);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not cache failures', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const cached = createCachedProvider(createProvider(openaiConfig()));

    await expect(cached.classifyField(FIELD_INPUT)).rejects.toBeTruthy();
    await expect(cached.classifyField(FIELD_INPUT)).rejects.toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cached.cacheSize()).toBe(0);
  });

  it('evicts the oldest entry beyond maxEntries', async () => {
    const inner: AIProvider = {
      classifyField: vi.fn().mockResolvedValue(VALID_CLASSIFICATION),
      analyzeQuestion: vi.fn(),
      generateAnswer: vi.fn(),
    };
    const cached = createCachedProvider(inner, { maxEntries: 2 });

    await cached.classifyField({ ...FIELD_INPUT, field: { label: 'A' } });
    await cached.classifyField({ ...FIELD_INPUT, field: { label: 'B' } });
    await cached.classifyField({ ...FIELD_INPUT, field: { label: 'C' } });

    expect(cached.cacheSize()).toBe(2);
  });
});
