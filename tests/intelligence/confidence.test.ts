// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  classificationBand,
  bandDescription,
  isClassifiable,
  UNKNOWN_MIN_CONFIDENCE,
} from '../../extension/src/intelligence/confidence';
import { classifyField } from '../../extension/src/intelligence/fieldClassifier';
import type { SemanticField } from '@schemas/dom';

function field(overrides: Partial<SemanticField>): SemanticField {
  return {
    id: 'f-test',
    selector: 'input',
    elementType: 'text',
    type: 'text',
    required: false,
    visible: true,
    disabled: false,
    fingerprint: 'test',
    ...overrides,
  };
}

describe('classification confidence bands', () => {
  it('maps confidences to the documented bands', () => {
    expect(classificationBand(0.99)).toBe('exact');
    expect(classificationBand(0.97)).toBe('exact');
    expect(classificationBand(0.94)).toBe('strong');
    expect(classificationBand(0.9)).toBe('strong');
    expect(classificationBand(0.85)).toBe('contextual');
    expect(classificationBand(0.75)).toBe('contextual');
    expect(classificationBand(0.65)).toBe('weak');
    expect(classificationBand(0.6)).toBe('weak');
    expect(classificationBand(0.59)).toBe('unknown');
    expect(classificationBand(0)).toBe('unknown');
  });

  it('describes each band in plain language', () => {
    expect(bandDescription(0.99)).toBe('exact match');
    expect(bandDescription(0.94)).toBe('strong synonym');
    expect(bandDescription(0.85)).toBe('contextual match');
    expect(bandDescription(0.65)).toBe('weak inference');
    expect(bandDescription(0.2)).toBe('unknown');
  });

  it('treats anything below 0.60 as unclassifiable', () => {
    expect(UNKNOWN_MIN_CONFIDENCE).toBe(0.6);
    expect(isClassifiable(0.6)).toBe(true);
    expect(isClassifiable(0.5999)).toBe(false);
  });
});

describe('classifier enforces the unknown threshold', () => {
  it('returns unknown for gibberish labels instead of guessing', () => {
    const result = classifyField(
      field({ label: 'Interdimensional pasta logistics preferences' })
    );
    expect(result.semanticField).toBe('unknown');
    expect(result.method).toBe('none');
    expect(result.confidence).toBe(0);
    expect(classificationBand(result.confidence)).toBe('unknown');
  });

  it('never emits a classified field below 0.60 confidence', () => {
    const labels = [
      'Favorite office chair color',
      'T-shirt size',
      'How did you hear about our podcast network',
      'Preferred snack for team meetings',
      'Do you own a telescope',
    ];
    for (const label of labels) {
      const result = classifyField(field({ label }));
      if (result.semanticField !== 'unknown') {
        expect(
          isClassifiable(result.confidence),
          `label "${label}" produced ${result.confidence}`
        ).toBe(true);
      }
    }
  });

  it('keeps strong matches above the band boundaries', () => {
    expect(classifyField(field({ label: 'Email Address' })).confidence).toBeGreaterThanOrEqual(0.94);
    expect(classifyField(field({ autocomplete: 'given-name' })).method).toBe('autocomplete');
    expect(classifyField(field({ autocomplete: 'given-name' })).confidence).toBe(0.99);
  });
});
