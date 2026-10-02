// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CandidateProfile } from '@schemas/candidate';
import { DEFAULT_AUTOFILL_SETTINGS, type AutofillSettings, type FilledField } from '@schemas/application';
import {
  refreshRegistry,
  getRegistry,
  type RegistryEntry,
} from '../../extension/src/content/fieldRegistry';
import { buildFillPlan, type FillPlan, type PlannerHooks } from '../../extension/src/intelligence/fillPlanner';
import { executeFillPlan, applyUserEdit, clearFillMarks } from '../../extension/src/content/formFiller';
import { detectCaptcha, CAPTCHA_MESSAGE } from '../../extension/src/content/captcha';
import { analyzeForm } from '../../extension/src/content/semanticExtractor';
import { observeFormChanges, stopObserving } from '../../extension/src/content/mutationObserver';

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
      firstName: 'John',
      lastName: 'Doe',
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
      summary: 'Backend engineer focused on distributed systems.',
      noticePeriod: '30 days',
    },
    links: {
      github: 'https://github.com/johndoe',
      linkedin: 'https://linkedin.com/in/john-doe',
      portfolio: 'https://johndoe.dev',
    },
    workAuthorization: { authorizedToWork: true, requiresSponsorship: false },
    experience: [],
    education: [
      {
        institution: 'IIT Delhi',
        degree: 'Bachelor of Technology',
        fieldOfStudy: 'Computer Science',
        graduationYear: 2019,
        gpa: '8.5',
      },
    ],
    skills: {
      programmingLanguages: ['TypeScript'],
      frameworks: ['React'],
      databases: ['PostgreSQL'],
      cloud: ['AWS'],
      tools: [],
      other: [],
    },
    applicationAnswers: [],
  } as unknown as CandidateProfile;
}

async function planFor(
  profile: CandidateProfile = makeProfile(),
  settings: AutofillSettings = DEFAULT_AUTOFILL_SETTINGS,
  hooks: PlannerHooks = {}
): Promise<FillPlan> {
  refreshRegistry();
  const fields = getRegistry().map((entry) => entry.field);
  return buildFillPlan(fields, profile, settings, hooks);
}

function entryBy(fragment: string): RegistryEntry {
  const needle = fragment.toLowerCase();
  const entry = getRegistry().find((e) =>
    [e.field.label, e.field.name, e.field.placeholder, e.field.ariaLabel]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(needle)
  );
  if (!entry) throw new Error(`no field matching "${fragment}"`);
  return entry;
}

function elBy(fragment: string): HTMLElement {
  return entryBy(fragment).element as HTMLElement;
}

function recordFor(
  result: { fields: FilledField[] },
  semanticField: string
): FilledField | undefined {
  return result.fields.find((f) => f.semanticField === semanticField);
}

beforeEach(() => {
  Element.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 100,
      bottom: 20,
      width: 100,
      height: 20,
      toJSON: () => ({}),
    } as DOMRect;
  };
  document.title = '';
  document.body.innerHTML = '';
  clearFillMarks();
});

afterEach(() => {
  stopObserving();
});

describe('random field names and ids', () => {
  beforeEach(() => loadFixture('random-fields.html'));

  it('fills every scannable field regardless of obfuscated markup', async () => {
    const plan = await planFor();
    expect(plan.actions.length).toBe(8);

    const result = await executeFillPlan(plan);
    expect(result.failedCount).toBe(0);
    expect(result.success).toBe(true);

    expect((elBy('full name') as HTMLInputElement).value).toBe('John A. Doe');
    expect((elBy('work e-mail') as HTMLInputElement).value).toBe('john@example-dev.io');
    expect((elBy('best contact') as HTMLInputElement).value).toBe('+91 98765 43210');
    expect((elBy('mailing city') as HTMLInputElement).value).toBe('Bengaluru');
    expect((elBy('review your code') as HTMLInputElement).value).toBe('https://github.com/johndoe');
    expect((elBy('linkedin') as HTMLInputElement).value).toBe('https://linkedin.com/in/john-doe');
    expect((elBy('years of relevant') as HTMLInputElement).value).toBe('6');
  });

  it('leaves the sponsorship question pending and never submits', async () => {
    const plan = await planFor();
    const submit = vi.fn();
    const form = document.querySelector('form')!;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      submit();
    });

    const result = await executeFillPlan(plan);

    const sponsorship = elBy('visa sponsorship') as HTMLSelectElement;
    expect(sponsorship.value).toBe('');
    expect(sponsorship.getAttribute('data-ua-pending')).toBe('true');
    expect(recordFor(result, 'requires_sponsorship')?.status).toBe('needs_review');

    expect(submit).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('records verified statuses for every action', async () => {
    const plan = await planFor();
    const result = await executeFillPlan(plan);

    expect(result.fields.length).toBe(plan.actions.length);
    expect(recordFor(result, 'email')?.status).toBe('needs_review');
    expect(recordFor(result, 'phone')?.status).toBe('filled');
    expect(recordFor(result, 'linkedin')?.status).toBe('filled');
    expect(
      result.fields.every((f) => ['filled', 'failed', 'skipped', 'needs_review'].includes(f.status))
    ).toBe(true);
  });
});

describe('React controlled inputs', () => {
  beforeEach(() => loadFixture('react-controlled.html'));

  it('fills a controlled input on the first strategy attempt', async () => {
    const plan = await planFor();
    const result = await executeFillPlan(plan);

    const email = document.getElementById('rc-email') as HTMLInputElement;
    expect(email.value).toBe('john@example-dev.io');

    const record = recordFor(result, 'email');
    expect(record?.status).toBe('filled');
    expect(record?.attempts).toBe(1);

    const states = (document as unknown as { __rcStates: Record<string, string> }).__rcStates;
    expect(states['rc-email']).toBe('john@example-dev.io');
  });

  it('retries when the first input event is swallowed', async () => {
    const plan = await planFor();
    const result = await executeFillPlan(plan);

    const gated = document.getElementById('rc-gated') as HTMLInputElement;
    expect(gated.value).toBe('John A. Doe');

    const states = (document as unknown as { __rcStates: Record<string, string> }).__rcStates;
    expect(states['rc-gated']).toBe('John A. Doe');

    const record = recordFor(result, 'full_name');
    expect(record?.attempts).toBe(2);
    expect(record?.status).toBe('needs_review');
  });

  it('fails verification when the page always reverts the value', async () => {
    const plan = await planFor();
    const result = await executeFillPlan(plan);

    const hostile = document.getElementById('rc-hostile') as HTMLInputElement;
    expect(hostile.value).toBe('');

    const record = recordFor(result, 'github');
    expect(record?.status).toBe('failed');
    expect(record?.attempts).toBe(3);
    expect(record?.error).toContain('cleared by the page');

    expect(result.failedCount).toBe(1);
    expect(result.success).toBe(false);
    expect(hostile.getAttribute('data-ua-highlight')).toBe('failed');
  });
});

describe('custom widgets', () => {
  beforeEach(() => loadFixture('widgets.html'));

  it('fills a contenteditable editor', async () => {
    const plan = await planFor();
    expect(plan.summary.total).toBe(4);

    const result = await executeFillPlan(plan);
    expect(result.failedCount).toBe(0);

    const editor = document.getElementById('w-summary')!;
    expect(editor.textContent).toBe('Backend engineer focused on distributed systems.');
    expect(recordFor(result, 'professional_summary')?.status).toBe('needs_review');
  });

  it('opens a custom combobox and picks the option by meaning', async () => {
    const plan = await planFor();
    const result = await executeFillPlan(plan);

    const trigger = document.getElementById('w-country')!;
    expect(trigger.textContent).toContain('India');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('w-country-list')!.hasAttribute('hidden')).toBe(true);
    expect(recordFor(result, 'country')?.status).toBe('needs_review');
  });

  it('checks a preference checkbox but never a legal declaration', async () => {
    const plan = await planFor();
    const result = await executeFillPlan(plan);

    const remote = document.getElementById('w-remote') as HTMLInputElement;
    const certify = document.getElementById('w-certify') as HTMLInputElement;
    expect(remote.checked).toBe(true);
    expect(certify.checked).toBe(false);
    expect(remote.getAttribute('data-ua-highlight')).toBe('review');
    expect(recordFor(result, 'terms_acceptance')?.status).toBe('skipped');

    const declaration = plan.actions.find((a) => a.semanticField === 'terms_acceptance')!;
    expect(declaration.decision).toBe('skip');
    expect(declaration.reason).toContain('legal declaration');

    const edited = await applyUserEdit(declaration, 'Yes');
    expect(edited.status).toBe('filled');
    expect(edited.method).toBe('user');
    expect(certify.checked).toBe(true);
  });
});

describe('selects and radio groups', () => {
  beforeEach(() => loadFixture('choice-form.html'));

  it('chooses a select option by meaning, not by value attribute', async () => {
    const plan = await planFor();
    expect(plan.summary.total).toBe(8);
    expect(plan.summary.skip).toBeGreaterThanOrEqual(1);

    const result = await executeFillPlan(plan);
    expect(result.failedCount).toBe(0);

    const degree = elBy('highest qualification') as HTMLSelectElement;
    expect(degree.selectedOptions[0]?.textContent).toBe('Bachelor of Technology');
    expect(degree.value).toBe('full');
    expect(degree.getAttribute('data-ua-highlight')).toBe('review');
  });

  it('answers work-authorization radios from the profile, label side first', async () => {
    const plan = await planFor();
    const result = await executeFillPlan(plan);

    const authYes = document.querySelector<HTMLInputElement>('input[name="work_auth"][value="1"]');
    const authNo = document.querySelector<HTMLInputElement>('input[name="work_auth"][value="0"]');
    const sponsorYes = document.querySelector<HTMLInputElement>('input[name="sponsorship"][value="1"]');
    const sponsorNo = document.querySelector<HTMLInputElement>('input[name="sponsorship"][value="0"]');

    expect(result.failedCount).toBe(0);
    expect(authYes?.checked).toBe(false);
    expect(sponsorYes?.checked).toBe(false);

    const auth = plan.actions.find((a) => a.semanticField === 'authorized_to_work')!;
    expect(auth.value).toBe('Yes');
    await applyUserEdit(auth, 'Yes');

    const sponsor = plan.actions.find((a) => a.semanticField === 'requires_sponsorship')!;
    expect(sponsor.value).toBe('No');
    await applyUserEdit(sponsor, 'No');

    expect(authYes?.checked).toBe(true);
    expect(authNo?.checked).toBe(false);

    expect(sponsorNo?.checked).toBe(true);
    expect(sponsorYes?.checked).toBe(false);

    const remote = document.querySelector<HTMLInputElement>('input[name="setup"][value="rmt"]');
    expect(remote?.checked).toBe(true);
  });

  it('keeps sensitive answers pending until the user confirms them', async () => {
    const plan = await planFor();
    const result = await executeFillPlan(plan);

    const auth = plan.actions.find((a) => a.semanticField === 'authorized_to_work')!;
    expect(auth.decision).toBe('ask_user');
    expect(recordFor(result, 'authorized_to_work')?.status).toBe('needs_review');

    const edited = await applyUserEdit(auth, 'Yes');
    expect(edited.status).toBe('filled');
    expect(
      document.querySelector<HTMLInputElement>('input[name="work_auth"][value="1"]')?.checked
    ).toBe(true);

    const declaration = plan.actions.find((a) => a.semanticField === 'terms_acceptance')!;
    expect(declaration.decision).toBe('skip');
    const certify = document.getElementById('ch-certify') as HTMLInputElement;
    expect(certify.checked).toBe(false);

    const confirmed = await applyUserEdit(declaration, 'Yes');
    expect(confirmed.status).toBe('filled');
    expect(certify.checked).toBe(true);
  });
});

describe('CAPTCHA handling', () => {
  beforeEach(() => loadFixture('captcha-form.html'));

  it('detects the challenge, reports it, and never touches it', async () => {
    expect(detectCaptcha()).toBe(true);

    const analysis = analyzeForm();
    expect(analysis.captchaDetected).toBe(true);

    const plan = await planFor();
    const result = await executeFillPlan(plan);
    expect(result.failedCount).toBe(0);

    const email = document.getElementById('cap-email') as HTMLInputElement;
    expect(email.value).toBe('john@example-dev.io');
    expect(recordFor(result, 'email')?.status).toBe('filled');
    expect(detectCaptcha()).toBe(true);

    const recaptcha = document.querySelector('.g-recaptcha');
    expect(recaptcha?.getAttribute('data-sitekey')).toBe('synthetic-test-key');
    expect(CAPTCHA_MESSAGE).toContain('complete it manually');
  });
});

describe('dynamic fields', () => {
  beforeEach(() => loadFixture('dynamic-form.html'));

  function addEmployerField(): void {
    document
      .getElementById('experience-list')!
      .insertAdjacentHTML(
        'beforeend',
        '<label for="dyn-emp">Current employer</label><input type="text" id="dyn-emp" name="employer" />'
      );
  }

  it('picks up fields inserted after the first scan', async () => {
    const history = new Map<string, string>();
    const first = await executeFillPlan(await planFor(), { history });
    expect(first.failedCount).toBe(0);
    expect((document.getElementById('dyn-name') as HTMLInputElement).value).toBe('John A. Doe');
    expect((document.getElementById('dyn-email') as HTMLInputElement).value).toBe(
      'john@example-dev.io'
    );

    addEmployerField();
    refreshRegistry();
    const second = await executeFillPlan(await planFor(makeProfile()), { history });

    const employer = document.getElementById('dyn-emp') as HTMLInputElement;
    expect(employer.value).toBe('Acme Technologies');
    expect(employer.getAttribute('data-ua-highlight')).toBe('review');
    expect(second.failedCount).toBe(0);

    const historySkips = second.fields.filter(
      (f) => f.reason === 'already filled in this session'
    );
    expect(historySkips.length).toBe(2);
  });

  it('runs analysis and fill end to end from a MutationObserver rescan', async () => {
    const history = new Map<string, string>();
    await executeFillPlan(await planFor(), { history });

    let runs = 0;
    let pending: Promise<unknown> = Promise.resolve();
    observeFormChanges(() => {
      runs += 1;
      pending = (async () => {
        const plan = await planFor();
        await executeFillPlan(plan, { history });
      })();
    });

    addEmployerField();
    await new Promise((resolve) => setTimeout(resolve, 1700));
    await pending;
    stopObserving();

    expect(runs).toBeGreaterThanOrEqual(1);
    const employer = document.getElementById('dyn-emp') as HTMLInputElement;
    expect(employer.value).toBe('Acme Technologies');
  }, 10000);
});

describe('multi-step forms', () => {
  beforeEach(() => loadFixture('multi-step.html'));

  it('fills only visible steps and never navigates or submits', async () => {
    const nextSpy = vi.fn();
    document.querySelectorAll('.next-btn').forEach((btn) => {
      btn.addEventListener('click', nextSpy);
    });
    const submitSpy = vi.fn();
    document.querySelector('form')!.addEventListener('submit', (event) => {
      event.preventDefault();
      submitSpy();
    });

    const history = new Map<string, string>();
    const first = await executeFillPlan(await planFor(), { history });
    expect(first.failedCount).toBe(0);
    expect((document.getElementById('ms-first') as HTMLInputElement).value).toBe('John');
    expect((document.getElementById('ms-last') as HTMLInputElement).value).toBe('Doe');
    expect((document.getElementById('ms-email') as HTMLInputElement).value).toBe(
      'john@example-dev.io'
    );
    expect((document.getElementById('ms-school') as HTMLInputElement).value).toBe('');

    const step1 = document.querySelector<HTMLElement>('[data-step="1"]')!;
    const step2 = document.querySelector<HTMLElement>('[data-step="2"]')!;
    step1.style.display = 'none';
    step2.style.display = '';

    const plan2 = await planFor();
    expect(plan2.actions.length).toBe(4);
    const second = await executeFillPlan(plan2, { history });
    expect(second.failedCount).toBe(0);

    expect((document.getElementById('ms-school') as HTMLInputElement).value).toBe('IIT Delhi');
    expect((document.getElementById('ms-degree') as HTMLInputElement).value).toBe(
      'Bachelor of Technology'
    );
    expect((document.getElementById('ms-grad-year') as HTMLInputElement).value).toBe('2019');
    expect((document.getElementById('ms-skills') as HTMLInputElement).value).toContain('TypeScript');

    const again = await executeFillPlan(await planFor(), { history });
    expect(again.skippedCount).toBe(plan2.actions.length);
    expect(again.fields.every((f) => f.reason === 'already filled in this session')).toBe(true);

    expect((document.getElementById('ms-first') as HTMLInputElement).value).toBe('John');
    expect((document.getElementById('ms-why') as HTMLTextAreaElement).value).toBe('');
    expect(nextSpy).not.toHaveBeenCalled();
    expect(submitSpy).not.toHaveBeenCalled();
  });
});

describe('highlight lifecycle', () => {
  beforeEach(() => loadFixture('captcha-form.html'));

  it('marks filled, review and pending fields and cleans up afterwards', async () => {
    const plan = await planFor();
    await executeFillPlan(plan);

    const style = document.getElementById('ua-autofill-styles');
    expect(style?.textContent).toContain('#16a34a');
    expect(style?.textContent).toContain('#f59e0b');
    expect(style?.textContent).toContain('#dc2626');

    const email = document.getElementById('cap-email')!;
    const name = document.getElementById('cap-name')!;
    expect(email.getAttribute('data-ua-highlight')).toBe('filled');
    expect(name.getAttribute('data-ua-highlight')).toBe('review');

    clearFillMarks();
    expect(document.querySelector('[data-ua-highlight]')).toBeNull();
    expect(document.getElementById('ua-autofill-styles')).toBeNull();
  });
});
