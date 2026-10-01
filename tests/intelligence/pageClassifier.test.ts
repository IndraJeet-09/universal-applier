// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { analyzeForm } from '../../extension/src/content/semanticExtractor';
import { classifyPage, type PageSignals } from '../../extension/src/intelligence/pageClassifier';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');

function loadFixture(name: string): void {
  const html = readFileSync(path.join(FIXTURES_DIR, name), 'utf-8');
  document.open();
  document.write(html);
  document.close();
}

function loadHtml(html: string): void {
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

function signals(overrides: Partial<PageSignals> = {}): PageSignals {
  return {
    url: 'https://example.com/page',
    title: '',
    headings: [],
    text: '',
    controls: [],
    fields: [],
    ...overrides,
  };
}

describe('page classification — fixtures', () => {
  it('classifies a full application form', () => {
    loadFixture('simple.html');
    const analysis = analyzeForm();
    expect(analysis.pageType).toBe('APPLICATION_FORM');
    expect(analysis.pageConfidence).toBeGreaterThanOrEqual(0.8);
    expect(analysis.pageReasons?.length).toBeGreaterThan(0);
  });

  it('classifies a multi-step application as APPLICATION_STEP', () => {
    loadFixture('multi-step.html');
    const analysis = analyzeForm();
    expect(analysis.pageType).toBe('APPLICATION_STEP');
    expect(analysis.formType).toBe('application');
  });

  it('classifies an obfuscated ATS application form', () => {
    loadFixture('unknown-ats.html');
    expect(analyzeForm().pageType).toBe('APPLICATION_FORM');
  });

  it('classifies an aria-driven application form', () => {
    loadFixture('react-like.html');
    expect(analyzeForm().pageType).toBe('APPLICATION_FORM');
  });

  it('never mistakes a contact form for a job application', () => {
    loadFixture('contact-form.html');
    const analysis = analyzeForm();
    expect(analysis.pageType).toBe('NOT_JOB_PAGE');
    expect(analysis.isJobApplication).toBe(false);
    expect(analysis.formType).toBe('contact');
  });

  it('classifies a job listing with an apply CTA and no form', () => {
    loadFixture('job-listing.html');
    const analysis = analyzeForm();
    expect(analysis.pageType).toBe('JOB_LISTING');
    expect(analysis.totalFields).toBe(0);
  });

  it('classifies a login page as NOT_JOB_PAGE', () => {
    loadHtml(`
      <title>Sign in</title>
      <h1>Sign in to your account</h1>
      <form>
        <label for="li-email">Email</label>
        <input id="li-email" type="email" name="email" />
        <label for="li-pass">Password</label>
        <input id="li-pass" type="password" name="password" />
        <button type="submit">Sign in</button>
      </form>
      <a href="/careers">Careers</a>
    `);
    const analysis = analyzeForm();
    expect(analysis.pageType).toBe('NOT_JOB_PAGE');
    expect(analysis.pageConfidence).toBeGreaterThanOrEqual(0.85);
  });

  it('classifies a plain page with no job signals as NOT_JOB_PAGE', () => {
    loadHtml(`
      <title>Recipes — Food Blog</title>
      <h1>Best pasta recipes</h1>
      <p>A quiet blog about weeknight cooking.</p>
    `);
    expect(analyzeForm().pageType).toBe('NOT_JOB_PAGE');
  });

  it('returns UNKNOWN when job evidence is too weak to decide', () => {
    loadHtml(`
      <title>Team Handbook</title>
      <h2>Requirements</h2>
      <p>Please read before your first week.</p>
    `);
    const analysis = analyzeForm();
    expect(analysis.pageType).toBe('UNKNOWN');
  });
});

describe('classifyPage — unit signals', () => {
  it('rejects contact-like pages without application evidence', () => {
    const result = classifyPage(
      signals({
        title: 'Contact Us',
        text: 'Send us a message and we will reply within a day.',
        controls: ['Send Message'],
        fields: [
          { label: 'Name' },
          { label: 'Email', type: 'email' },
          { label: 'Message' },
        ],
      })
    );
    expect(result.pageType).toBe('NOT_JOB_PAGE');
  });

  it('marks step pages when progress copy and navigation controls are present', () => {
    const result = classifyPage(
      signals({
        title: 'Application',
        text: 'Step 2 of 4 — Experience',
        controls: ['Back', 'Next'],
        fields: [{ label: 'Resume', type: 'file' }, { label: 'Email', type: 'email' }],
      })
    );
    expect(result.pageType).toBe('APPLICATION_STEP');
  });

  it('prefers JOB_LISTING when there is an apply control but no form', () => {
    const result = classifyPage(
      signals({
        title: 'Backend Engineer | Apply',
        text: 'Responsibilities: build APIs. Requirements: TypeScript.',
        controls: ['Apply Now'],
        fields: [],
      })
    );
    expect(result.pageType).toBe('JOB_LISTING');
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('stays UNKNOWN rather than guessing on ambiguous pages', () => {
    const result = classifyPage(
      signals({ title: 'Company Blog', text: 'We are hiring writers someday maybe.' })
    );
    expect(['UNKNOWN', 'NOT_JOB_PAGE']).toContain(result.pageType);
    expect(result.pageType).not.toBe('APPLICATION_FORM');
  });
});
