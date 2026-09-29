// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SemanticField } from '@schemas/dom';
import type { CandidateProfile } from '@schemas/candidate';
import { DEFAULT_AUTOFILL_SETTINGS, type AutofillSettings } from '@schemas/application';
import { scanFields } from '../../extension/src/content/semanticExtractor';
import { buildFillPlan, type FillPlan, type PlannerHooks } from '../../extension/src/intelligence/fillPlanner';
import type { Classification } from '../../extension/src/intelligence/fieldClassifier';

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

function makeField(partial: Partial<SemanticField> & { id: string }): SemanticField {
  return {
    selector: `#${partial.id}`,
    elementType: partial.type ?? 'text',
    required: false,
    visible: true,
    disabled: false,
    fingerprint: partial.id,
    ...partial,
  };
}

function actionFor(plan: FillPlan, predicate: (semanticField: string) => boolean) {
  const action = plan.actions.find((a) => predicate(a.semanticField));
  if (!action) throw new Error('no planned action matched');
  return action;
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

describe('buildFillPlan on simple.html', () => {
  beforeEach(() => loadFixture('simple.html'));

  it('auto-fills high-confidence identity fields from the profile', async () => {
    const plan = await buildFillPlan(scanFields(), makeProfile(), DEFAULT_AUTOFILL_SETTINGS);

    const email = actionFor(plan, (f) => f === 'email');
    expect(email.decision).toBe('auto_fill');
    expect(email.value).toBe('john@example-dev.io');
    expect(email.valueSource).toBe('profile');
    expect(email.confidence).toBeGreaterThanOrEqual(0.95);

    const linkedin = actionFor(plan, (f) => f === 'linkedin');
    expect(linkedin.decision).toBe('auto_fill');
    expect(linkedin.value).toBe('https://linkedin.com/in/john-doe');
  });

  it('marks medium-confidence fields for highlight review', async () => {
    const plan = await buildFillPlan(scanFields(), makeProfile(), DEFAULT_AUTOFILL_SETTINGS);

    const name = actionFor(plan, (f) => f === 'full_name');
    expect(name.decision).toBe('fill_highlight');
    expect(name.value).toBe('John A. Doe');
    expect(name.review?.suggestedValue).toBe('John A. Doe');

    const years = actionFor(plan, (f) => f === 'years_experience');
    expect(years.decision).toBe('fill_highlight');
    expect(years.value).toBe('6');
  });

  it('never auto-fills sensitive fields', async () => {
    const plan = await buildFillPlan(scanFields(), makeProfile(), DEFAULT_AUTOFILL_SETTINGS);

    for (const action of plan.actions) {
      if (action.sensitive) {
        expect(action.decision).not.toBe('auto_fill');
        expect(action.decision).not.toBe('fill_highlight');
      }
    }

    const authorized = actionFor(plan, (f) => f === 'authorized_to_work');
    expect(authorized.sensitive).toBe(true);
    expect(authorized.decision).toBe('ask_user');
    expect(authorized.value).toBe('Yes');

    const terms = actionFor(plan, (f) => f === 'terms_acceptance');
    expect(terms.decision).toBe('skip');
    expect(terms.value).toBeNull();
  });

  it('plans the resume file as a user-confirmed action', async () => {
    const plan = await buildFillPlan(scanFields(), makeProfile(), DEFAULT_AUTOFILL_SETTINGS);
    const resume = actionFor(plan, (f) => f === 'resume');
    expect(resume.kind).toBe('file');
    expect(resume.decision).toBe('ask_user');

    const withUpload: AutofillSettings = { ...DEFAULT_AUTOFILL_SETTINGS, autoUploadResume: true };
    const plan2 = await buildFillPlan(scanFields(), makeProfile(), withUpload);
    expect(actionFor(plan2, (f) => f === 'resume').decision).toBe('auto_fill');
  });

  it('skips open questions without hooks and fills them when an answer hook exists', async () => {
    const withoutHooks = await buildFillPlan(scanFields(), makeProfile(), DEFAULT_AUTOFILL_SETTINGS);
    expect(actionFor(withoutHooks, (f) => f === 'why_company').decision).toBe('skip');

    const hooks: PlannerHooks = {
      generateAnswer: vi.fn().mockResolvedValue({
        answer: 'Acme’s developer-tooling mission matches my experience.',
        confidence: 0.75,
      }),
    };
    const plan = await buildFillPlan(scanFields(), makeProfile(), DEFAULT_AUTOFILL_SETTINGS, hooks);

    const why = actionFor(plan, (f) => f === 'why_company');
    expect(why.valueSource).toBe('ai_generated');
    expect(why.decision).toBe('ask_user');
    expect(why.value).toContain('Acme');
    expect(hooks.generateAnswer).toHaveBeenCalledTimes(1);
  });

  it('never generates AI answers for sensitive questions', async () => {
    loadFixture('ambiguous-form.html');
    const hooks: PlannerHooks = { generateAnswer: vi.fn() };
    const plan = await buildFillPlan(scanFields(), makeProfile(), DEFAULT_AUTOFILL_SETTINGS, hooks);
    expect(hooks.generateAnswer).not.toHaveBeenCalled();
    expect(plan.summary.sensitive).toBeGreaterThan(0);
  });

  it('summarizes decisions', async () => {
    const plan = await buildFillPlan(scanFields(), makeProfile(), DEFAULT_AUTOFILL_SETTINGS);
    expect(plan.summary.total).toBe(plan.actions.length);
    expect(plan.summary.autoFill).toBeGreaterThanOrEqual(3);
    expect(plan.summary.sensitive).toBeGreaterThanOrEqual(2);
    const counts =
      plan.summary.autoFill +
      plan.summary.fillHighlight +
      plan.summary.askUser +
      plan.summary.skip;
    expect(counts).toBe(plan.summary.total);
  });
});

describe('buildFillPlan hooks and edge cases', () => {
  const aiClassification: Classification = {
    semanticField: 'years_experience',
    category: 'professional',
    confidence: 0.9,
    method: 'ai',
    reason: 'ai classified the counter field',
  };

  it('uses AI classification only for unknown fields', async () => {
    const fields = [
      makeField({ id: 'known', label: 'Email Address', type: 'email' }),
      makeField({ id: 'zorp', label: 'Zorp counter', type: 'text' }),
    ];
    const classifyWithAI = vi.fn().mockResolvedValue(aiClassification);

    const plan = await buildFillPlan(fields, makeProfile(), DEFAULT_AUTOFILL_SETTINGS, {
      classifyWithAI,
    });

    expect(classifyWithAI).toHaveBeenCalledTimes(1);
    expect(classifyWithAI.mock.calls[0][0].id).toBe('zorp');
    expect(plan.summary.aiClassified).toBe(1);

    const zorp = plan.actions.find((a) => a.fieldId === 'zorp');
    expect(zorp?.classification.method).toBe('ai');
    expect(zorp?.value).toBe('6');
    expect(zorp?.decision).toBe('fill_highlight');

    const known = plan.actions.find((a) => a.fieldId === 'known');
    expect(known?.classification.method).not.toBe('ai');
    expect(known?.decision).toBe('auto_fill');
  });

  it('keeps the deterministic result when the AI hook fails', async () => {
    const fields = [makeField({ id: 'zorp', label: 'Zorp counter', type: 'text' })];
    const plan = await buildFillPlan(fields, makeProfile(), DEFAULT_AUTOFILL_SETTINGS, {
      classifyWithAI: vi.fn().mockRejectedValue(new Error('offline')),
    });
    expect(plan.actions[0].classification.method).not.toBe('ai');
    expect(plan.actions[0].decision).toBe('skip');
  });

  it('skips invisible and disabled fields', async () => {
    const fields = [
      makeField({ id: 'hidden', label: 'Email Address', type: 'email', visible: false }),
      makeField({ id: 'off', label: 'Email Address', type: 'email', disabled: true }),
    ];
    const plan = await buildFillPlan(fields, makeProfile(), DEFAULT_AUTOFILL_SETTINGS);
    expect(plan.actions.every((a) => a.decision === 'skip')).toBe(true);
    expect(plan.actions[0].reason).toContain('not visible');
    expect(plan.actions[1].reason).toContain('disabled');
  });

  it('skips choice fields whose options do not contain the profile value', async () => {
    const fields = [
      makeField({
        id: 'choice',
        label: 'Email Address',
        type: 'select',
        options: ['Option A', 'Option B'],
      }),
    ];
    const plan = await buildFillPlan(fields, makeProfile(), DEFAULT_AUTOFILL_SETTINGS);
    expect(plan.actions[0].decision).toBe('skip');
    expect(plan.actions[0].reason).toContain('no option matches');
  });

  it('fills choice fields when an option matches', async () => {
    const fields = [
      makeField({
        id: 'auth',
        label: 'Are you authorized to work?',
        type: 'select',
        options: ['Yes', 'No'],
      }),
    ];
    const plan = await buildFillPlan(fields, makeProfile(), DEFAULT_AUTOFILL_SETTINGS);
    expect(plan.actions[0].value).toBe('Yes');
    expect(plan.actions[0].decision).toBe('ask_user');
  });
});
