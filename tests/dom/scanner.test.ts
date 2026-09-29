// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { scanFields, analyzeForm, groupIntoSections } from '../../extension/src/content/semanticExtractor';
import { collectShadowRoots } from '../../extension/src/content/shadowDomScanner';

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

describe('scanFields — simple form', () => {
  beforeEach(() => loadFixture('simple.html'));

  it('finds all form controls', () => {
    const fields = scanFields();
    expect(fields.length).toBeGreaterThanOrEqual(12);
  });

  it('resolves labels via label[for]', () => {
    const fields = scanFields();
    const email = fields.find((f) => f.name === 'email');
    expect(email?.label).toBe('Email Address');
    expect(email?.autocomplete).toBe('email');

    const name = fields.find((f) => f.id.includes('full-name') || f.name === 'full_name');
    expect(name?.label).toBe('Full Name');
  });

  it('resolves wrapping labels (checkbox)', () => {
    const fields = scanFields();
    const terms = fields.find((f) => f.type === 'checkbox');
    expect(terms?.label).toContain('Terms of Service');
  });

  it('captures select options', () => {
    const fields = scanFields();
    const select = fields.find((f) => f.type === 'select');
    expect(select?.options).toEqual(['Select…', 'Yes', 'No']);
  });

  it('groups fields under fieldset legends', () => {
    const fields = scanFields();
    const sections = groupIntoSections(fields);
    const names = sections.map((s) => s.name);
    expect(names).toContain('Personal Information');
    expect(names).toContain('Professional Links');
    expect(names).toContain('Additional Questions');
  });

  it('detects a job application form', () => {
    const analysis = analyzeForm();
    expect(analysis.formType).toBe('application');
    expect(analysis.isJobApplication).toBe(true);
    expect(analysis.totalFields).toBeGreaterThanOrEqual(12);
    expect(analysis.jobContext?.title).toContain('Software Engineer');
  });

  it('produces unique fingerprints', () => {
    const fields = scanFields();
    const fingerprints = fields.map((f) => f.fingerprint);
    expect(new Set(fingerprints).size).toBe(fingerprints.length);
  });
});

describe('scanFields — unknown ATS with random names', () => {
  beforeEach(() => loadFixture('unknown-ats.html'));

  it('extracts semantic labels despite random field names', () => {
    const fields = scanFields();
    const codeField = fields.find((f) => f.name === 'field_3928');
    expect(codeField).toBeDefined();
    expect(codeField?.label).toBe('Where can we find your code?');
    expect(codeField?.placeholder).toBe('https://github.com/...');

    const years = fields.find((f) => f.name === 'field_1102');
    expect(years?.label).toBe('How many years have you worked professionally?');
  });

  it('classifies as job application', () => {
    expect(analyzeForm().formType).toBe('application');
  });
});

describe('scanFields — lever-like sibling labels', () => {
  beforeEach(() => loadFixture('lever-like.html'));

  it('resolves labels from previous siblings', () => {
    const fields = scanFields();
    expect(fields.find((f) => f.name === 'name')?.label).toBe('Name');
    expect(fields.find((f) => f.name === 'email')?.label).toBe('Email');
    expect(fields.find((f) => f.name === 'resume')?.label).toBe('Resume/CV');
  });

  it('classifies as job application', () => {
    expect(analyzeForm().formType).toBe('application');
  });
});

describe('scanFields — react-like aria driven form', () => {
  beforeEach(() => loadFixture('react-like.html'));

  it('uses aria-label when no label exists', () => {
    const fields = scanFields();
    const firstName = fields.find((f) => f.ariaLabel === 'First name');
    expect(firstName?.label).toBe('First name');
    expect(fields.some((f) => f.ariaLabel === 'City')).toBe(true);
  });

  it('detects custom combobox controls', () => {
    const fields = scanFields();
    const combo = fields.find((f) => f.role === 'combobox');
    expect(combo).toBeDefined();
    expect(combo?.ariaLabel).toBe('Country/Region');
  });

  it('resolves wrapping label text', () => {
    const fields = scanFields();
    const portfolio = fields.find((f) => f.label?.includes('portfolio'));
    expect(portfolio).toBeDefined();
  });

  it('classifies as job application', () => {
    expect(analyzeForm().formType).toBe('application');
  });
});

describe('scanFields — shadow DOM', () => {
  beforeEach(() => {
    loadFixture('shadow-dom.html');
    const outer = document.querySelector('applicant-widget');
    if (outer && !outer.shadowRoot) {
      const root = outer.attachShadow({ mode: 'open' });
      root.innerHTML = `
        <label for="sh-name">Full name</label>
        <input type="text" id="sh-name" name="full_name" />
        <label for="sh-phone">Phone</label>
        <input type="tel" id="sh-phone" name="phone" />
        <div><span>GitHub username</span><input type="text" aria-label="GitHub username" /></div>
        <nested-widget></nested-widget>
      `;
      const nested = root.querySelector('nested-widget');
      if (nested && !nested.shadowRoot) {
        const nestedRoot = nested.attachShadow({ mode: 'open' });
        nestedRoot.innerHTML = `
          <label for="sh-linkedin">LinkedIn Profile</label>
          <input type="text" id="sh-linkedin" name="linkedin" />
        `;
      }
    }
  });

  it('discovers nested shadow roots', () => {
    expect(collectShadowRoots(document).length).toBe(2);
  });

  it('scans fields inside shadow roots', () => {
    const fields = scanFields();
    const labels = fields.map((f) => f.label);
    expect(labels).toContain('Full name');
    expect(labels).toContain('GitHub username');
    expect(labels).toContain('LinkedIn Profile');
    expect(fields.length).toBeGreaterThanOrEqual(5);
  });
});

describe('scanFields — multi-step visibility', () => {
  beforeEach(() => loadFixture('multi-step.html'));

  it('only returns visible fields from the active step', () => {
    const fields = scanFields();
    const ids = fields.map((f) => f.selector);
    expect(fields.length).toBeGreaterThanOrEqual(3);
    expect(ids.some((s) => s.includes('ms-first'))).toBe(true);
    expect(ids.some((s) => s.includes('ms-school'))).toBe(false);
    expect(ids.some((s) => s.includes('ms-why'))).toBe(false);
  });

  it('classifies as job application', () => {
    expect(analyzeForm().formType).toBe('application');
  });
});