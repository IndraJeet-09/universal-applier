export type AIErrorCode =
  | 'no_api_key'
  | 'network'
  | 'timeout'
  | 'rate_limited'
  | 'provider_error'
  | 'invalid_response'
  | 'bad_request'
  | 'disabled';

export class AIError extends Error {
  readonly code: AIErrorCode;
  readonly status?: number;

  constructor(code: AIErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'AIError';
    this.code = code;
    this.status = status;
  }
}

export function isAIError(err: unknown): err is AIError {
  return err instanceof AIError;
}

export function toAIError(err: unknown): AIError {
  if (isAIError(err)) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new AIError('network', message);
}
