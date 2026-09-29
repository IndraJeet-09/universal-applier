// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CandidateProfile } from '@schemas/candidate';
import { DEFAULT_AUTOFILL_SETTINGS, type AutofillSettings } from '@schemas/application';
import { refreshRegistry, getRegistry } from '../../extension/src/content/fieldRegistry';
import { buildFillPlan, type PlannerHooks, type FillPlan } from '../../extension/src/intelligence/fillPlanner';
import { executeFillPlan, clearFillMarks } from '../../extension/src/content/formFiller';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');

function loadFixture(name: string): void {
  const html = readFileSync(path.join(FIXTURES_DIR, name), 'utf-8');
  document.open();
  document.write(html);
  document.close();
}

function makeProfile(): CandidateProfile {
  return {
    personal: {
      fullName: 'John A. Doe',
      email: 'john@example-dev.io',
      phone: '+91 98765 43210',
      city: 'Bengaluru',
      country: 'India',
    },
    professional: {
      currentRole: 'Senior Software Engineer',
      currentCompany: 'Acme Technologies',
      yearsOfExperience: 6,
      remotePreference: 'remote',
    },
    links: {
      github: 'https://github.com/johndoe',
      linkedin: 'https://linkedin.com/in/john-doe',
      portfolio: 'https://johndoe.dev',
    },
    workAuthorization: { authorizedToWork: true, requiresSponsorship: false },
    experience: [],
    education: [],
    skills: {
      programmingLanguages: ['TypeScript'],
      frameworks: ['React'],
      databases: [],
      cloud: [],
      tools: [],
      other: [],
    },
    applicationAnswers: [],
  } as unknown as CandidateProfile;
}

async function planFor(
  profile: CandidateProfile,
  settings: AutofillSettings = DEFAULT_AUTOFILL_SETTINGS,
  hooks: PlannerHooks = {}
): Promise<FillPlan> {
  refreshRegistry();
  const fields = getRegistry().map((entry) => entry.field);
  return buildFillPlan(fields, profile, settings, hooks);
}

function inputByLabel(fragment: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const fields = getRegistry();
  const entry = fields.find((e) =>
    [e.field.label, e.field.name].filter(Boolean).join(' ').toLowerCase().includes(fragment.toLowerCase())
  );
  if (!entry) throw new Error(`no field matching "${fragment}"`);
  return entry.element as HTMLInputElement;
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
  clearFillMarks();
});

describe('executeFillPlan on simple.html', () => {
  beforeEach(() => loadFixture('simple.html'));

  it('fills auto-fill fields and marks review fields', async () => {
    const plan = await planFor(makeProfile());
    const result = executeFillPlan(plan);

    expect(result.failedCount).toBe(0);
    expect(result.success).toBe(true);
    expect(result.filledCount).toBeGreaterThanOrEqual(3);

    const email = inputByLabel('email') as HTMLInputElement;
    expect(email.value).toBe('john@example-dev.io');
    expect(email.getAttribute('data-ua-highlight')).toBe('filled');

    const name = inputByLabel('full name') as HTMLInputElement;
    expect(name.value).toBe('John A. Doe');
    expect(name.getAttribute('data-ua-highlight')).toBe('review');

    const recordFor = (semanticField: string) =>
      result.fields.find((f) => f.semanticField === semanticField);
    expect(recordFor('email')?.status).toBe('success');
    expect(recordFor('full_name')?.status).toBe('needs_review');
    expect(recordFor('terms_acceptance')?.status).toBe('skipped');
    expect(recordFor('authorized_to_work')?.status).toBe('needs_review');
  });

  it('does not touch sensitive or pending fields', async () => {
    const plan = await planFor(makeProfile());
    executeFillPlan(plan);

    const terms = inputByLabel('terms') as HTMLInputElement;
    expect(terms.checked).toBe(false);

    const authorized = inputByLabel('authorized') as HTMLSelectElement;
    expect(authorized.value).toBe('');
    expect(authorized.getAttribute('data-ua-pending')).toBe('true');
  });

  it('dispatches input events that frameworks listen to', async () => {
    const plan = await planFor(makeProfile());
    const email = inputByLabel('email');
    const listener = vi.fn();
    email.addEventListener('input', listener);

    executeFillPlan(plan);
    expect(listener).toHaveBeenCalled();
  });

  it('reports a failed upload when no resume file is configured', async () => {
    const settings: AutofillSettings = { ...DEFAULT_AUTOFILL_SETTINGS, autoUploadResume: true };
    const plan = await planFor(makeProfile(), settings);
    const result = executeFillPlan(plan);

    const resume = result.fields.find((f) => f.semanticField === 'resume');
    expect(resume?.status).toBe('failed');
    expect(resume?.error).toContain('no resume file');
    expect(result.failedCount).toBe(1);
    expect(result.success).toBe(false);
  });

  it('records a failure when the page changed before filling', async () => {
    const plan = await planFor(makeProfile());
    document.body.innerHTML = '';
    refreshRegistry();

    const result = executeFillPlan(plan);
    expect(result.failedCount).toBeGreaterThan(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.success).toBe(false);
  });

  it('counts every planned action exactly once', async () => {
    const plan = await planFor(makeProfile());
    const result = executeFillPlan(plan);

    expect(result.fields.length).toBe(plan.actions.length);
    expect(
      result.filledCount + result.failedCount + result.skippedCount + result.needsReviewCount
    ).toBe(plan.actions.length);
  });
});

describe('executeFillPlan on lever-like.html', () => {
  beforeEach(() => loadFixture('lever-like.html'));

  it('selects the matching option in a select field', async () => {
    const profile = makeProfile();
    profile.applicationAnswers = [
      {
        id: 'a1',
        question: 'How did you hear about this job?',
        answer: 'Referral',
        scope: 'global',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
    const plan = await planFor(profile);
    const result = executeFillPlan(plan);

    const select = inputByLabel('hear') as HTMLSelectElement;
    expect(select.value).toBe('Referral');
    expect(select.getAttribute('data-ua-highlight')).toBe('review');

    const referral = result.fields.find((f) => f.semanticField === 'referral_source');
    expect(referral?.status).toBe('needs_review');
    expect(result.failedCount).toBe(0);
  });
});

describe('executeFillPlan radio groups', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <form>
        <div class="q">
          <span>Remote preference</span>
          <label><input type="radio" name="remote" value="remote" /> Remote</label>
          <label><input type="radio" name="remote" value="office" /> Office</label>
        </div>
      </form>
    `;
  });

  it('checks only the matching radio option', async () => {
    const plan = await planFor(makeProfile());
    const result = executeFillPlan(plan);

    const remote = document.querySelector<HTMLInputElement>('input[value="remote"]');
    const office = document.querySelector<HTMLInputElement>('input[value="office"]');
    expect(remote?.checked).toBe(true);
    expect(office?.checked).toBe(false);
    expect(result.failedCount).toBe(0);

    const filled = result.fields.find((f) => f.semanticField === 'remote_preference');
    expect(filled?.status).toBe('needs_review');
  });
});

describe('clearFillMarks', () => {
  beforeEach(() => loadFixture('simple.html'));

  it('removes highlight and pending markers', async () => {
    const plan = await planFor(makeProfile());
    executeFillPlan(plan);
    expect(document.querySelector('[data-ua-highlight]')).toBeTruthy();

    clearFillMarks();
    expect(document.querySelector('[data-ua-highlight]')).toBeNull();
    expect(document.querySelector('[data-ua-pending]')).toBeNull();
  });
});
