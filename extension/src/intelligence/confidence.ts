export type FillDecision = 'auto_fill' | 'fill_highlight' | 'ask_user' | 'skip';

export interface DecisionContext {
  confidence: number;
  sensitive: boolean;
  hasValue: boolean;
  autoFillHighConfidence: boolean;
  requireConfirmation: boolean;
  skipSensitiveFields: boolean;
}

export function decideFill(ctx: DecisionContext): FillDecision {
  const { confidence, sensitive, hasValue } = ctx;

  if (!hasValue) return 'skip';
  if (confidence < 0.6) return 'skip';

  if (sensitive) {
    if (ctx.skipSensitiveFields) return 'ask_user';
    if (confidence >= 0.95) return 'ask_user';
    return 'ask_user';
  }

  if (confidence >= 0.95) {
    return ctx.autoFillHighConfidence ? 'auto_fill' : 'fill_highlight';
  }
  if (confidence >= 0.8) {
    return ctx.requireConfirmation ? 'fill_highlight' : 'auto_fill';
  }
  if (confidence >= 0.6) {
    return 'ask_user';
  }
  return 'skip';
}

export const CONFIDENCE_BANDS = {
  autoFill: 0.95,
  fillHighlight: 0.8,
  askUser: 0.6,
} as const;

export function bandLabel(confidence: number): string {
  if (confidence >= CONFIDENCE_BANDS.autoFill) return 'high';
  if (confidence >= CONFIDENCE_BANDS.fillHighlight) return 'medium';
  if (confidence >= CONFIDENCE_BANDS.askUser) return 'low';
  return 'none';
}