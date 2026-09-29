import type {
  AIConfig,
  AIProvider,
  FieldClassificationInput,
  FieldClassificationOutput,
  AnswerGenerationInput,
  AnswerGenerationOutput,
  QuestionAnalysisInput,
  QuestionAnalysisOutput,
} from '@schemas/ai';
import type { ZodType } from 'zod';
import { AIError } from './errors';
import { postJson, extractJsonObject, DEFAULT_TIMEOUT_MS } from './client';
import {
  buildClassifyMessages,
  buildAnalyzeQuestionMessages,
  buildAnswerMessages,
  type ChatMessage,
} from './prompts';
import {
  fieldClassificationOutputSchema,
  questionAnalysisOutputSchema,
  answerGenerationOutputSchema,
} from './outputs';

export const MAX_AI_CONFIDENCE = 0.9;

function requireApiKey(config: AIConfig): string {
  const key = config.apiKey?.trim();
  if (!key) {
    throw new AIError('no_api_key', `provider "${config.provider}" requires an API key`);
  }
  return key;
}

function contentOf(response: unknown): string {
  const choices = (response as { choices?: Array<{ message?: { content?: unknown } }> })?.choices;
  const content = choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new AIError('provider_error', 'provider response missing message content');
  }
  return content;
}

abstract class ChatProvider implements AIProvider {
  protected constructor(protected readonly config: AIConfig) {}

  protected abstract chat(messages: ChatMessage[], temperature: number): Promise<string>;

  protected async completeJson<T>(messages: ChatMessage[], schema: ZodType<T>): Promise<T> {
    const temperature = this.config.temperature ?? 0.2;
    let text = await this.chat(messages, temperature);
    let lastError: AIError | null = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const parsed = schema.safeParse(extractJsonObject(text));
        if (parsed.success) return parsed.data;
        lastError = new AIError(
          'invalid_response',
          `response failed validation: ${parsed.error.issues[0]?.message ?? 'unknown issue'}`
        );
      } catch (err) {
        lastError = err instanceof AIError ? err : new AIError('invalid_response', String(err));
      }

      if (attempt === 0) {
        text = await this.chat(
          [
            ...messages,
            { role: 'assistant', content: text.slice(0, 1200) },
            {
              role: 'user',
              content: `Your previous response was invalid (${lastError.message}). Respond again with ONLY a single valid JSON object matching the requested shape.`,
            },
          ],
          temperature
        );
      }
    }

    throw lastError ?? new AIError('invalid_response', 'response was not valid');
  }

  async classifyField(input: FieldClassificationInput): Promise<FieldClassificationOutput> {
    const result = await this.completeJson(
      buildClassifyMessages(input),
      fieldClassificationOutputSchema
    );
    return { ...result, confidence: Math.min(result.confidence, MAX_AI_CONFIDENCE) };
  }

  async analyzeQuestion(input: QuestionAnalysisInput): Promise<QuestionAnalysisOutput> {
    return this.completeJson(buildAnalyzeQuestionMessages(input), questionAnalysisOutputSchema);
  }

  async generateAnswer(input: AnswerGenerationInput): Promise<AnswerGenerationOutput> {
    const result = await this.completeJson(
      buildAnswerMessages(input),
      answerGenerationOutputSchema
    );
    return { ...result, confidence: Math.min(result.confidence, MAX_AI_CONFIDENCE) };
  }
}

export class OpenAICompatibleProvider extends ChatProvider {
  private readonly endpoint: string;
  private readonly apiKey?: string;

  constructor(config: AIConfig) {
    super(config);
    const defaults: Record<string, string> = {
      openai: 'https://api.openai.com/v1/chat/completions',
      groq: 'https://api.groq.com/openai/v1/chat/completions',
    };
    const url = config.baseUrl?.trim() || defaults[config.provider];
    if (!url) {
      throw new AIError('bad_request', 'custom provider requires baseUrl');
    }
    this.endpoint = url;
    this.apiKey = config.apiKey?.trim() || undefined;
    if (!this.apiKey && config.provider !== 'custom') {
      requireApiKey(config);
    }
  }

  protected async chat(messages: ChatMessage[], temperature: number): Promise<string> {
    const jsonFormat =
      this.config.provider === 'openai' || this.config.provider === 'groq'
        ? { response_format: { type: 'json_object' } }
        : {};

    const response = await postJson({
      url: this.endpoint,
      headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
      body: {
        model: this.config.model,
        messages,
        temperature,
        max_tokens: this.config.maxTokens ?? 1024,
        ...jsonFormat,
      },
      timeoutMs: this.config.timeout ?? DEFAULT_TIMEOUT_MS,
    });
    return contentOf(response);
  }
}

export class AnthropicProvider extends ChatProvider {
  private readonly endpoint: string;
  private readonly apiKey: string;

  constructor(config: AIConfig) {
    super(config);
    this.endpoint = config.baseUrl?.trim() || 'https://api.anthropic.com/v1/messages';
    this.apiKey = requireApiKey(config);
  }

  protected async chat(messages: ChatMessage[], temperature: number): Promise<string> {
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const conversation = messages.filter((m) => m.role !== 'system');

    const response = await postJson({
      url: this.endpoint,
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: {
        model: this.config.model,
        system,
        messages: conversation,
        temperature,
        max_tokens: this.config.maxTokens ?? 1024,
      },
      timeoutMs: this.config.timeout ?? DEFAULT_TIMEOUT_MS,
    });

    const blocks = (response as { content?: Array<{ type: string; text?: string }> })?.content;
    const text = blocks?.find((b) => b.type === 'text')?.text;
    if (!text) {
      throw new AIError('provider_error', 'anthropic response missing text content');
    }
    return text;
  }
}

export function createProvider(config: AIConfig): AIProvider {
  switch (config.provider) {
    case 'openai':
    case 'groq':
    case 'custom':
      return new OpenAICompatibleProvider(config);
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'local':
      throw new AIError(
        'disabled',
        'local AI is not bundled; extension stays deterministic-only until a remote provider is configured'
      );
    default:
      throw new AIError('disabled', `unknown provider "${String(config.provider)}"`);
  }
}
