import type {
  AIProvider,
  FieldClassificationInput,
  FieldClassificationOutput,
  AnswerGenerationInput,
  AnswerGenerationOutput,
  QuestionAnalysisInput,
  QuestionAnalysisOutput,
} from '@schemas/ai';

export interface CacheOptions {
  ttlMs?: number;
  maxEntries?: number;
}

export interface CachedAIProvider extends AIProvider {
  clearCache(): void;
  cacheSize(): number;
}

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

export function createCachedProvider(
  inner: AIProvider,
  options: CacheOptions = {}
): CachedAIProvider {
  const ttlMs = options.ttlMs ?? 5 * 60_000;
  const maxEntries = options.maxEntries ?? 100;
  const entries = new Map<string, CacheEntry>();

  function memo<T>(key: string, compute: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = entries.get(key);
    if (hit && hit.expiresAt > now) {
      entries.delete(key);
      entries.set(key, hit);
      return Promise.resolve(hit.value as T);
    }
    if (hit) entries.delete(key);

    return compute().then((value) => {
      entries.set(key, { value, expiresAt: now + ttlMs });
      if (entries.size > maxEntries) {
        const oldest = entries.keys().next();
        if (!oldest.done) entries.delete(oldest.value);
      }
      return value;
    });
  }

  return {
    classifyField: (input: FieldClassificationInput): Promise<FieldClassificationOutput> =>
      memo(`cf:${JSON.stringify(input)}`, () => inner.classifyField(input)),
    analyzeQuestion: (input: QuestionAnalysisInput): Promise<QuestionAnalysisOutput> =>
      memo(`aq:${input.question} ${input.context ?? ''}`, () => inner.analyzeQuestion(input)),
    generateAnswer: (input: AnswerGenerationInput): Promise<AnswerGenerationOutput> =>
      memo(`ga:${JSON.stringify(input)}`, () => inner.generateAnswer(input)),
    clearCache: () => entries.clear(),
    cacheSize: () => entries.size,
  };
}
