export type FillDecision = 'auto_fill' | 'fill_highlight' | 'ask_user' | 'skip';

export interface DecisionContext {
  confidence: number;
  sensitive: boolean;
  hasValue: boolean;
  autoFillHighConfidence: boolean;
  requireConfirmation: boolean;
  skipSensitiveFields: boolean;
}

/**
 * Confidence bands for semantic classifications:
 *
 *   Exact autocomplete / exact label   >= 0.97   -> "exact"
 *   Strong synonym                     >= 0.90   -> "strong"
 *   Contextual match                   >= 0.75   -> "contextual"
 *   Weak inference                     >= 0.60   -> "weak"
 *   Unknown                            <  0.60   -> discarded
 */
export const UNKNOWN_MIN_CONFIDENCE = 0.6;

export const CLASSIFICATION_BANDS = {
  exact: 0.97,
  strong: 0.9,
  contextual: 0.75,
  weak: UNKNOWN_MIN_CONFIDENCE,
} as const;

export type ClassificationBand = 'exact' | 'strong' | 'contextual' | 'weak' | 'unknown';

export function classificationBand(confidence: number): ClassificationBand {
  if (confidence >= CLASSIFICATION_BANDS.exact) return 'exact';
  if (confidence >= CLASSIFICATION_BANDS.strong) return 'strong';
  if (confidence >= CLASSIFICATION_BANDS.contextual) return 'contextual';
  if (confidence >= CLASSIFICATION_BANDS.weak) return 'weak';
  return 'unknown';
}

export function bandDescription(confidence: number): string {
  switch (classificationBand(confidence)) {
    case 'exact':
      return 'exact match';
    case 'strong':
      return 'strong synonym';
    case 'contextual':
      return 'contextual match';
    case 'weak':
      return 'weak inference';
    default:
      return 'unknown';
  }
}

export function isClassifiable(confidence: number): boolean {
  return confidence >= UNKNOWN_MIN_CONFIDENCE;
}

export function decideFill(ctx: DecisionContext): FillDecision {
  const { confidence, sensitive, hasValue } = ctx;

  if (!hasValue) return 'skip';
  if (!isClassifiable(confidence)) return 'skip';

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