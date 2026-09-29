// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { scanFields, groupIntoSections } from '../../extension/src/content/semanticExtractor';
import { classifyField } from '../../extension/src/intelligence/fieldClassifier';
import type { SemanticField } from '@schemas/dom';

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

function findBy(finder: (f: SemanticField) => boolean, fields = scanFields()): SemanticField {
  const field = fields.find(finder);
  if (!field) throw new Error('field not found in fixture');
  return field;
}

function expectField(labelFragment: string, expectedField: string, minConfidence = 0.7): void {
  const fields = scanFields();
  const fragment = labelFragment.toLowerCase();
  const haystack = (f: SemanticField): string =>
    [f.label, f.ariaLabel, f.placeholder, f.description]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
  const field =
    fields.find((f) => haystack(f).includes(fragment)) ??
    findBy((f) => (f.surroundingText ?? '').toLowerCase().includes(fragment), fields);
  const result = classifyField(field);
  expect(result.semanticField, `label "${field.label}"`).toBe(expectedField);
  expect(result.confidence, `label "${field.label}" confidence`).toBeGreaterThanOrEqual(minConfidence);
}

describe('deterministic classification — simple.html', () => {
  beforeEach(() => loadFixture('simple.html'));

  it('classifies core identity fields', () => {
    expectField('Full Name', 'full_name', 0.9);
    expectField('Email Address', 'email', 0.95);
    expectField('Phone Number', 'phone', 0.9);
    expectField('Current Location', 'city', 0.6);
  });

  it('classifies professional links', () => {
    expectField('LinkedIn Profile', 'linkedin', 0.9);
    expectField('GitHub Profile', 'github', 0.9);
    expectField('Portfolio Website', 'portfolio', 0.85);
  });

  it('classifies experience and file fields', () => {
    expectField('Years of professional experience', 'years_experience', 0.85);
    expectField('Current Job Title', 'current_title', 0.85);
    expectField('Resume/CV', 'resume', 0.95);
  });

  it('classifies select and open-ended questions', () => {
    expectField('authorized to work', 'authorized_to_work', 0.85);
    expectField('Why do you want to work', 'why_company', 0.8);
  });

  it('flags legal acceptance as sensitive-adjacent field', () => {
    expectField('Terms of Service', 'terms_acceptance', 0.85);
  });
});

describe('deterministic classification — unknown-ats.html', () => {
  beforeEach(() => loadFixture('unknown-ats.html'));

  it('understands random field names via labels', () => {
    const fields = scanFields();

    const code = findBy((f) => f.name === 'field_3928', fields);
    expect(classifyField(code).semanticField).toBe('github');

    const years = findBy((f) => f.name === 'field_1102', fields);
    const yearsResult = classifyField(years);
    expect(yearsResult.semanticField).toBe('years_experience');
    expect(yearsResult.confidence).toBeGreaterThanOrEqual(0.7);

    const salary = findBy((f) => f.name === 'field_5510', fields);
    expect(classifyField(salary).semanticField).toBe('salary_expectation');

    const whyRole = findBy((f) => f.name === 'field_6600', fields);
    expect(classifyField(whyRole).semanticField).toBe('why_role');
  });

  it('classifies identity fields', () => {
    expectField('Your name', 'full_name', 0.85);
    expectField('Email', 'email', 0.9);
    expectField('Phone number', 'phone', 0.9);
  });
});

describe('deterministic classification — lever-like.html', () => {
  beforeEach(() => loadFixture('lever-like.html'));

  it('classifies sibling-labelled fields', () => {
    expectField('Resume/CV', 'resume', 0.95);
    expectField('LinkedIn Profile URL', 'linkedin', 0.9);
    expectField('Website', 'portfolio', 0.85);
    expectField('How did you hear', 'referral_source', 0.85);
  });
});

describe('deterministic classification — react-like.html', () => {
  beforeEach(() => loadFixture('react-like.html'));

  it('classifies aria-driven fields', () => {
    expectField('First name', 'first_name', 0.85);
    expectField('Last name', 'last_name', 0.85);
    expectField('Email address', 'email', 0.9);
    expectField('Country/Region', 'country', 0.7);
    expectField('portfolio', 'portfolio', 0.7);
    expectField('design experience', 'years_experience', 0.7);
  });
});

describe('deterministic classification — ambiguous-form.html', () => {
  beforeEach(() => loadFixture('ambiguous-form.html'));

  it('classifies radio groups from question text in context', () => {
    const fields = scanFields();
    const authRadios = fields.filter((f) => f.name === 'field_2');
    expect(authRadios.length).toBe(2);
    const result = classifyField(authRadios[0]);
    expect(result.semanticField).toBe('authorized_to_work');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);

    const sponsorRadios = fields.filter((f) => f.name === 'field_3');
    expect(classifyField(sponsorRadios[0]).semanticField).toBe('requires_sponsorship');
  });

  it('classifies sensitive open-ended fields', () => {
    expectField('salary expectations', 'salary_expectation', 0.85);
    expectField('Preferred pronouns', 'pronouns', 0.85);
    expectField('see your code', 'github', 0.8);
    expectField('worked professionally', 'years_experience', 0.85);
  });
});

describe('section grouping sanity', () => {
  beforeEach(() => loadFixture('simple.html'));

  it('every field belongs to a section', () => {
    const fields = scanFields();
    const sections = groupIntoSections(fields);
    const total = sections.reduce((sum, s) => sum + s.fields.length, 0);
    expect(total).toBe(fields.length);
  });
});