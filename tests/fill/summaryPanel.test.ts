// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CandidateProfile } from '@schemas/candidate';
import type { FormAnalysis } from '@schemas/dom';
import { DEFAULT_AUTOFILL_SETTINGS, type AutofillResult, type FilledField } from '@schemas/application';
import { refreshRegistry, getRegistry } from '../../extension/src/content/fieldRegistry';
import { buildFillPlan, type FillPlan, type PlannedFill } from '../../extension/src/intelligence/fillPlanner';
import { createSummaryPanel } from '../../extension/src/content/summaryPanel';
import { CAPTCHA_MESSAGE } from '../../extension/src/content/captcha';

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
      programmingLanguages: [],
      frameworks: [],
      databases: [],
      cloud: [],
      tools: [],
      other: [],
    },
    applicationAnswers: [],
  } as unknown as CandidateProfile;
}

async function planFor(): Promise<FillPlan> {
  refreshRegistry();
  const fields = getRegistry().map((entry) => entry.field);
  return buildFillPlan(fields, makeProfile(), DEFAULT_AUTOFILL_SETTINGS);
}

function makeAnalysis(captchaDetected?: boolean): FormAnalysis {
  return {
    url: 'https://jobs.example.test/apply',
    timestamp: new Date().toISOString(),
    formType: 'application',
    isJobApplication: true,
    ...(captchaDetected !== undefined ? { captchaDetected } : {}),
    sections: [],
    totalFields: 10,
    fillableFields: 8,
    highConfidenceFields: 3,
    needsReviewFields: 5,
    fingerprint: 'fp-summary-test',
  };
}

function actionFor(plan: FillPlan, semanticField: string): PlannedFill {
  const action = plan.actions.find((a) => a.semanticField === semanticField);
  if (!action) throw new Error(`no action for ${semanticField}`);
  return action;
}

function mkField(action: PlannedFill, status: FilledField['status']): FilledField {
  return {
    fieldId: action.fieldId,
    semanticField: action.semanticField,
    value: action.value ?? '',
    confidence: action.confidence,
    method: 'deterministic',
    status,
    timestamp: new Date().toISOString(),
  };
}

function makeResult(plan: FillPlan): AutofillResult {
  return {
    success: false,
    filledCount: 1,
    failedCount: 1,
    skippedCount: 1,
    needsReviewCount: 1,
    fields: [
      mkField(actionFor(plan, 'email'), 'filled'),
      mkField(actionFor(plan, 'full_name'), 'needs_review'),
      mkField(actionFor(plan, 'terms_acceptance'), 'skipped'),
      mkField(actionFor(plan, 'github'), 'failed'),
    ],
    errors: ['github: value was cleared by the page after fill'],
  };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 30));
}

function buttonByText(root: ParentNode, text: string): HTMLButtonElement | null {
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('button'));
  return buttons.find((btn) => btn.textContent?.trim() === text) ?? null;
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
  document.getElementById('ua-summary-panel')?.remove();
});

describe('createSummaryPanel', () => {
  beforeEach(() => loadFixture('simple.html'));

  it('shows plan counts and reveals the mapping list on Review & Fill', async () => {
    const plan = await planFor();
    const panel = createSummaryPanel(plan, makeAnalysis());
    document.documentElement.appendChild(panel.element);

    const shadow = panel.element.shadowRoot!;
    expect(shadow.querySelector('h2')?.textContent).toBe('Application Detected');
    expect(shadow.querySelector('.total')?.textContent).toBe(`${plan.summary.total} fields`);

    const lines = Array.from(shadow.querySelectorAll('.counts > div')).map((el) => el.textContent);
    expect(lines[0]).toBe(`✓ ${plan.summary.autoFill} confident`);
    expect(lines[1]).toBe(`⚠ ${plan.summary.fillHighlight} uncertain`);
    expect(lines[2]).toBe(`? ${plan.summary.askUser} need input`);

    expect(shadow.querySelector('.mappings')?.classList.contains('open')).toBe(false);
    expect(shadow.querySelectorAll('.map').length).toBe(plan.actions.length);
    expect(shadow.querySelector('.map .map-value')?.textContent).toBeTruthy();

    const review = buttonByText(shadow, 'Review & Fill')!;
    review.click();
    expect(shadow.querySelector('.mappings')?.classList.contains('open')).toBe(true);
    expect(buttonByText(shadow, 'Fill form')).toBeTruthy();

    const chips = shadow.querySelectorAll('[data-role="map-chip"]');
    expect(chips.length).toBe(plan.actions.length);
    panel.destroy();
    expect(document.getElementById('ua-summary-panel')).toBeNull();
  });

  it('shows the CAPTCHA notice only when a challenge was detected', async () => {
    const plan = await planFor();
    const withCaptcha = createSummaryPanel(plan, makeAnalysis(true));
    expect(withCaptcha.element.shadowRoot!.querySelector('.captcha')?.textContent).toBe(
      CAPTCHA_MESSAGE
    );
    withCaptcha.destroy();

    const without = createSummaryPanel(plan, makeAnalysis(false));
    expect(without.element.shadowRoot!.querySelector('.captcha')).toBeNull();
    without.destroy();

    const unknown = createSummaryPanel(plan, undefined);
    expect(unknown.element.shadowRoot!.querySelector('.captcha')).toBeNull();
    unknown.destroy();
  });

  it('runs the fill, reports verification results and updates chips', async () => {
    const plan = await planFor();
    const result = makeResult(plan);
    const onFill = vi.fn().mockResolvedValue(result);
    const onOpenReview = vi.fn();
    const panel = createSummaryPanel(plan, makeAnalysis(), { onFill, onOpenReview });
    document.documentElement.appendChild(panel.element);

    const shadow = panel.element.shadowRoot!;
    const review = buttonByText(shadow, 'Review & Fill')!;
    review.click();
    expect(onFill).not.toHaveBeenCalled();

    const fill = buttonByText(shadow, 'Fill form')!;
    expect(fill.disabled).toBe(false);
    fill.click();

    await flush();
    expect(onFill).toHaveBeenCalledTimes(1);

    const results = shadow.querySelector('.results')!;
    expect(results.textContent).toContain('1 filled · 1 uncertain · 1 skipped');
    expect(results.textContent).toContain('1 failed verification');
    expect(results.textContent).toContain('value was cleared by the page');
    expect(results.textContent).toContain('submit manually');

    const chipFor = (semanticField: string) =>
      shadow
        .querySelector(`[data-field-id="${actionFor(plan, semanticField).fieldId}"]`)
        ?.querySelector('[data-role="map-chip"]');

    expect(chipFor('email')?.textContent).toBe('filled');
    expect(chipFor('github')?.textContent).toBe('failed');
    expect(chipFor('terms_acceptance')?.textContent).toBe('skipped');
    expect(chipFor('full_name')?.textContent).toBe('needs review');

    expect(shadow.querySelector('button.secondary')?.textContent).toBe(
      'Review 1 fields that need input'
    );
    (shadow.querySelector('button.secondary') as HTMLButtonElement).click();
    expect(onOpenReview).toHaveBeenCalledTimes(1);

    fill.click();
    expect(onFill).toHaveBeenCalledTimes(1);
    panel.destroy();
  });

  it('surfaces fill errors and keeps the button usable', async () => {
    const plan = await planFor();
    const onFill = vi.fn().mockRejectedValue(new Error('plan execution exploded'));
    const panel = createSummaryPanel(plan, makeAnalysis(), { onFill });
    document.documentElement.appendChild(panel.element);

    const shadow = panel.element.shadowRoot!;
    buttonByText(shadow, 'Review & Fill')!.click();
    buttonByText(shadow, 'Fill form')!.click();
    await flush();

    const results = shadow.querySelector('.results')!;
    expect(results.textContent).toContain('plan execution exploded');
    expect(onFill).toHaveBeenCalledTimes(1);

    const retry = buttonByText(shadow, 'Fill form')!;
    expect(retry.disabled).toBe(false);
    retry.click();
    await flush();
    expect(onFill).toHaveBeenCalledTimes(2);
    panel.destroy();
  });

  it('closes through the header button', async () => {
    const plan = await planFor();
    const onClose = vi.fn();
    const panel = createSummaryPanel(plan, makeAnalysis(), { onClose });
    document.documentElement.appendChild(panel.element);

    (panel.element.shadowRoot!.querySelector('.close') as HTMLButtonElement).click();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.getElementById('ua-summary-panel')).toBeNull();
  });
});
