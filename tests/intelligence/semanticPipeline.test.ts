// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { analyzeForm, scanFields } from '../../extension/src/content/semanticExtractor';
import { classifyField } from '../../extension/src/intelligence/fieldClassifier';
import { isClassifiable, classificationBand } from '../../extension/src/intelligence/confidence';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');

function loadFixture(name: string): void {
  const html = readFileSync(path.join(FIXTURES_DIR, name), 'utf-8');
  document.open();
  document.write(html);
  document.close();
}

beforeEach(() => {
  Element.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
    return {
      x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 20,
      width: 100, height: 20, toJSON: () => ({}),
    } as DOMRect;
  };
  document.title = '';
  document.body.innerHTML = '';
});

const APPLICATION_FIXTURES = [
  'simple.html',
  'random-fields.html',
  'react-like.html',
  'dynamic-form.html',
  'multi-step.html',
  'ambiguous-form.html',
  'unknown-ats.html',
  'lever-like.html',
];

/**
 * Final requirement: an arbitrary synthetic application form must yield
 *   Semantic Form → Field list → Meaning → Confidence
 * with no website-specific selectors anywhere.
 */
describe('universal semantic pipeline', () => {
  for (const fixture of APPLICATION_FIXTURES) {
    it(`produces meaning and confidence for every field in ${fixture}`, () => {
      loadFixture(fixture);

      const analysis = analyzeForm();
      expect(['APPLICATION_FORM', 'APPLICATION_STEP']).toContain(analysis.pageType);
      expect(analysis.pageType).not.toBe('NOT_JOB_PAGE');

      const fields = scanFields();
      expect(fields.length).toBeGreaterThanOrEqual(2);

      const rows = fields.map((field) => ({ field, classification: classifyField(field) }));

      for (const row of rows) {
        expect(row.classification.semanticField).toBeTruthy();
        expect(row.classification.confidence).toBeGreaterThanOrEqual(0);
        expect(row.classification.confidence).toBeLessThanOrEqual(1);
        expect(row.classification.reason).toBeTruthy();
        if (row.classification.semanticField !== 'unknown') {
          expect(isClassifiable(row.classification.confidence)).toBe(true);
          expect(classificationBand(row.classification.confidence)).not.toBe('unknown');
        }
      }

      const known = rows.filter((r) => r.classification.semanticField !== 'unknown');
      expect(known.length / rows.length).toBeGreaterThanOrEqual(0.5);
      expect(known.some((r) => r.classification.confidence >= 0.9)).toBe(true);

      expect(analysis.pageConfidence).toBeGreaterThanOrEqual(0.8);
      expect(analysis.pageReasons?.length).toBeGreaterThan(0);
    });
  }

  it('finds meaning in the obfuscated ATS form without any site-specific rules', () => {
    loadFixture('unknown-ats.html');
    const rows = scanFields().map((field) => ({ field, classification: classifyField(field) }));

    const byField = (name: string) => rows.find((r) => r.field.name === name)?.classification;
    expect(byField('field_3928')?.semanticField).toBe('github');
    expect(byField('field_1102')?.semanticField).toBe('years_experience');
    expect(byField('field_5510')?.semanticField).toBe('salary_expectation');
    expect(byField('field_6600')?.semanticField).toBe('why_role');
    expect(byField('candidate_email')?.semanticField).toBe('email');
  });
});
