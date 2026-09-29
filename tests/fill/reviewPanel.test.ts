// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CandidateProfile } from '@schemas/candidate';
import { DEFAULT_AUTOFILL_SETTINGS } from '@schemas/application';
import { refreshRegistry, getRegistry } from '../../extension/src/content/fieldRegistry';
import { buildFillPlan, type FillPlan } from '../../extension/src/intelligence/fillPlanner';
import { createReviewPanel } from '../../extension/src/content/reviewPanel';

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

function reviewableCount(plan: FillPlan): number {
  return plan.actions.filter(
    (a) => a.decision === 'ask_user' || a.decision === 'fill_highlight'
  ).length;
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
  document.getElementById('ua-review-panel')?.remove();
});

describe('createReviewPanel', () => {
  beforeEach(() => loadFixture('simple.html'));

  it('renders one row per reviewable action', async () => {
    const plan = await planFor();
    const panel = createReviewPanel(plan);
    document.documentElement.appendChild(panel.element);

    const rows = panel.element.shadowRoot!.querySelectorAll('.item');
    expect(rows.length).toBe(reviewableCount(plan));
    expect(rows.length).toBeGreaterThan(0);

    const count = panel.element.shadowRoot!.querySelector('.count');
    expect(count?.textContent).toContain(`${rows.length} remaining`);

    panel.destroy();
    expect(document.getElementById('ua-review-panel')).toBeNull();
  });

  it('marks sensitive items', async () => {
    const plan = await planFor();
    const panel = createReviewPanel(plan);
    const sensitiveBadges = panel.element.shadowRoot!.querySelectorAll('.badge.sensitive');
    expect(sensitiveBadges.length).toBe(
      plan.actions.filter(
        (a) => a.sensitive && (a.decision === 'ask_user' || a.decision === 'fill_highlight')
      ).length
    );
    panel.destroy();
  });

  it('fills the field when the user confirms a value', async () => {
    const plan = await planFor();
    const initial = reviewableCount(plan);
    const panel = createReviewPanel(plan);
    document.documentElement.appendChild(panel.element);

    const shadow = panel.element.shadowRoot!;
    const rows = Array.from(shadow.querySelectorAll<HTMLElement>('.item'));
    const nameRow = rows.find((row) =>
      (row.querySelector('.label') as HTMLElement)?.textContent?.includes('Full Name')
    );
    expect(nameRow).toBeDefined();

    const input = nameRow!.querySelector('textarea') as HTMLTextAreaElement;
    expect(input.value).toBe('John A. Doe');

    (nameRow!.querySelector('.btn') as HTMLButtonElement).click();

    const nameInput = document.querySelector<HTMLInputElement>('input[name="full_name"]');
    expect(nameInput?.value).toBe('John A. Doe');
    expect(nameRow!.classList.contains('applied')).toBe(true);
    expect(input.disabled).toBe(true);
    expect(nameRow!.querySelector('.status')?.textContent).toContain('Filled');

    const remaining = shadow.querySelector('.count');
    expect(remaining?.textContent).toContain(`${initial - 1} remaining`);
    panel.destroy();
  });

  it('skips items without applying them', async () => {
    const plan = await planFor();
    const initial = reviewableCount(plan);
    const panel = createReviewPanel(plan);
    document.documentElement.appendChild(panel.element);

    const row = panel.element.shadowRoot!.querySelectorAll<HTMLElement>('.item')[0];
    const buttons = row.querySelectorAll<HTMLButtonElement>('.btn');
    buttons[1].click();

    expect(row.classList.contains('dismissed')).toBe(true);
    expect(row.querySelector('.status')?.textContent).toBe('Skipped');
    const count = panel.element.shadowRoot!.querySelector('.count');
    expect(count?.textContent).toContain(`${initial - 1} remaining`);
    panel.destroy();
  });

  it('invokes callbacks for custom handling', async () => {
    const plan = await planFor();
    const onApply = vi.fn().mockReturnValue({ status: 'failed', error: 'nope' });
    const onDismiss = vi.fn();
    const onClose = vi.fn();
    const panel = createReviewPanel(plan, { onApply, onDismiss, onClose });
    document.documentElement.appendChild(panel.element);

    const rows = panel.element.shadowRoot!.querySelectorAll<HTMLElement>('.item');
    (rows[0].querySelector('.btn') as HTMLButtonElement).click();
    expect(onApply).toHaveBeenCalled();
    expect(rows[0].querySelector('.status')?.textContent).toContain('Failed');

    rows[1].querySelectorAll<HTMLButtonElement>('.btn')[1].click();
    expect(onDismiss).toHaveBeenCalled();

    (panel.element.shadowRoot!.querySelector('.close') as HTMLButtonElement).click();
    expect(onClose).toHaveBeenCalled();
    expect(document.getElementById('ua-review-panel')).toBeNull();
  });

  it('shows an empty state when nothing needs review', async () => {
    const plan = await planFor();
    for (const action of plan.actions) {
      if (action.decision !== 'skip') action.decision = 'skip';
    }
    const panel = createReviewPanel(plan);
    expect(panel.element.shadowRoot!.querySelector('.empty')?.textContent).toContain(
      'No fields need review'
    );
    panel.destroy();
  });
});
