import { AIError } from './errors';

export const DEFAULT_TIMEOUT_MS = 30_000;

interface PostJsonOptions {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  timeoutMs?: number;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
}

export async function postJson(options: PostJsonOptions): Promise<unknown> {
  const { url, headers, body, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (isAbortError(err)) {
      throw new AIError('timeout', `request timed out after ${timeoutMs}ms`);
    }
    throw new AIError('network', err instanceof Error ? err.message : 'network request failed');
  }

  if (response.status === 429) {
    throw new AIError('rate_limited', 'provider rate limit reached', 429);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new AIError(
      'provider_error',
      `provider returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`,
      response.status
    );
  }

  try {
    return (await response.json()) as unknown;
  } catch {
    throw new AIError('provider_error', 'provider returned a non-JSON body');
  }
}

export function extractJsonObject(text: string): unknown {
  let candidate = text.trim();
  const fence = candidate.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence?.[1]) candidate = fence[1].trim();

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new AIError('invalid_response', 'response did not contain a JSON object');
  }

  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new AIError('invalid_response', 'response contained malformed JSON');
  }
}
