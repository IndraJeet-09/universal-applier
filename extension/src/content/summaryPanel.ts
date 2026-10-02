import type { FormAnalysis } from '@schemas/dom';
import type { AutofillResult } from '@schemas/application';
import type { FillPlan } from '../intelligence/fillPlanner';
import { CAPTCHA_MESSAGE } from './captcha';

export interface SummaryPanelCallbacks {
  /** Executes the fill plan and returns the verification results. */
  onFill?: () => Promise<AutofillResult>;
  /** Opens the per-field review panel for values that need user input. */
  onOpenReview?: () => void;
  onClose?: () => void;
}

export interface SummaryPanel {
  element: HTMLElement;
  destroy(): void;
}

const STYLES = `
:host { all: initial; }
.panel {
  position: fixed; top: 16px; right: 16px; z-index: 2147483646;
  width: 380px; max-height: calc(100vh - 32px); display: flex; flex-direction: column;
  background: #ffffff; color: #111827; border: 1px solid #e5e7eb; border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0,0,0,.18); font: 13px/1.4 system-ui, sans-serif;
  overflow: hidden;
}
.header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 12px; border-bottom: 1px solid #e5e7eb; background: #f9fafb;
}
.header h2 { margin: 0; font-size: 13px; font-weight: 600; }
.close { border: 0; background: transparent; cursor: pointer; font-size: 16px; color: #6b7280; padding: 0 4px; }
.close:hover { color: #111827; }
.body { overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.total { font-size: 15px; font-weight: 600; }
.counts { display: flex; flex-direction: column; gap: 3px; color: #374151; font-size: 12.5px; }
.counts .ok { color: #166534; }
.counts .warn { color: #92400e; }
.counts .ask { color: #1d4ed8; }
.counts .muted { color: #6b7280; }
.captcha {
  background: #fef3c7; color: #92400e; border: 1px solid #fcd34d;
  border-radius: 6px; padding: 6px 8px; font-size: 12px;
}
.btn {
  border: 0; border-radius: 6px; padding: 7px 10px; font: inherit; font-weight: 600;
  cursor: pointer; background: #2563eb; color: #fff; width: 100%;
}
.btn:hover { background: #1d4ed8; }
.btn:disabled { background: #9ca3af; cursor: default; }
.btn.secondary { background: #e5e7eb; color: #374151; }
.btn.secondary:hover { background: #d1d5db; }
.mappings { display: none; flex-direction: column; gap: 6px; max-height: 40vh; overflow-y: auto; }
.mappings.open { display: flex; }
.map {
  border: 1px solid #e5e7eb; border-radius: 6px; padding: 6px 8px; background: #fff; font-size: 12px;
}
.map-head { display: flex; justify-content: space-between; gap: 6px; align-items: baseline; }
.map-label { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.map-semantic { color: #6b7280; font-size: 11px; }
.map-value { color: #111827; margin-top: 2px; word-break: break-word; }
.map-path { color: #9ca3af; font-size: 10.5px; }
.chip { font-size: 10px; border-radius: 999px; padding: 1px 6px; flex-shrink: 0; }
.chip.matched { background: #dcfce7; color: #166534; }
.chip.needs_review { background: #fef3c7; color: #92400e; }
.chip.skipped { background: #f3f4f6; color: #374151; }
.chip.failed { background: #fee2e2; color: #991b1b; }
.results { border-top: 1px solid #e5e7eb; padding-top: 8px; display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; }
.results .ok { color: #166534; font-weight: 600; }
.results .bad { color: #b91c1c; }
.errors { color: #b91c1c; font-size: 11.5px; list-style: pl-disc; padding-left: 16px; margin: 0; }
.hint { color: #6b7280; font-size: 11.5px; }
`;

function statusChip(status: string): HTMLSpanElement {
  const chip = document.createElement('span');
  chip.className = `chip ${status}`;
  chip.textContent =
    status === 'matched'
      ? 'matched'
      : status === 'needs_review'
        ? 'needs review'
        : status === 'failed'
          ? 'failed'
          : 'skipped';
  return chip;
}

function confidenceText(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

export function createSummaryPanel(
  plan: FillPlan,
  analysis: FormAnalysis | undefined,
  callbacks: SummaryPanelCallbacks = {}
): SummaryPanel {
  const host = document.createElement('div');
  host.id = 'ua-summary-panel';
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = STYLES;
  shadow.appendChild(style);

  const panel = document.createElement('div');
  panel.className = 'panel';
  shadow.appendChild(panel);

  const header = document.createElement('div');
  header.className = 'header';
  const title = document.createElement('h2');
  title.textContent = 'Application Detected';
  const close = document.createElement('button');
  close.className = 'close';
  close.setAttribute('aria-label', 'Close summary panel');
  close.textContent = '×';
  header.append(title, close);
  panel.appendChild(header);

  const body = document.createElement('div');
  body.className = 'body';
  panel.appendChild(body);

  const { summary } = plan;

  const total = document.createElement('div');
  total.className = 'total';
  total.textContent = `${summary.total} fields`;
  body.appendChild(total);

  const counts = document.createElement('div');
  counts.className = 'counts';
  const lines: Array<{ cls: string; text: string }> = [
    { cls: 'ok', text: `✓ ${summary.autoFill} confident` },
    { cls: 'warn', text: `⚠ ${summary.fillHighlight} uncertain` },
    { cls: 'ask', text: `? ${summary.askUser} need input` },
  ];
  if (summary.skip > 0) lines.push({ cls: 'muted', text: `– ${summary.skip} skipped` });
  for (const line of lines) {
    const el = document.createElement('div');
    el.className = line.cls;
    el.textContent = line.text;
    counts.appendChild(el);
  }
  body.appendChild(counts);

  if (analysis?.captchaDetected) {
    const captcha = document.createElement('div');
    captcha.className = 'captcha';
    captcha.textContent = CAPTCHA_MESSAGE;
    body.appendChild(captcha);
  }

  const mappings = document.createElement('div');
  mappings.className = 'mappings';
  for (const action of plan.actions) {
    const row = document.createElement('div');
    row.className = 'map';
    row.dataset.fieldId = action.fieldId;

    const head = document.createElement('div');
    head.className = 'map-head';
    const label = document.createElement('span');
    label.className = 'map-label';
    label.textContent = action.label || action.semanticField;
    label.title = action.selector;
    head.appendChild(label);

    const mapping = plan.mappings.find((m) => m.fieldId === action.fieldId);
    const chip = statusChip(mapping?.status ?? 'skipped');
    chip.dataset.role = 'map-chip';
    head.appendChild(chip);
    row.appendChild(head);

    const semantic = document.createElement('div');
    semantic.className = 'map-semantic';
    semantic.textContent = `${action.semanticField} · ${confidenceText(action.confidence)}`;
    row.appendChild(semantic);

    const value = document.createElement('div');
    value.className = 'map-value';
    value.textContent =
      action.value !== null && action.value.length > 0
        ? action.value.length > 120
          ? `${action.value.slice(0, 120)}…`
          : action.value
        : 'NEEDS USER INPUT';
    row.appendChild(value);

    if (mapping?.candidatePath) {
      const path = document.createElement('div');
      path.className = 'map-path';
      path.textContent = `profile.${mapping.candidatePath}`;
      row.appendChild(path);
    }

    mappings.appendChild(row);
  }
  body.appendChild(mappings);

  const reviewButton = document.createElement('button');
  reviewButton.className = 'btn';
  reviewButton.textContent = 'Review & Fill';
  body.appendChild(reviewButton);

  const results = document.createElement('div');
  results.className = 'results';
  results.style.display = 'none';
  body.appendChild(results);

  let stage: 'summary' | 'review' | 'filled' = 'summary';

  close.addEventListener('click', () => {
    callbacks.onClose?.();
    host.remove();
  });

  reviewButton.addEventListener('click', () => {
    if (stage === 'summary') {
      stage = 'review';
      mappings.classList.add('open');
      reviewButton.textContent = 'Fill form';
      return;
    }
    if (stage !== 'review' || !callbacks.onFill) return;
    reviewButton.disabled = true;
    reviewButton.textContent = 'Filling…';
    void (async () => {
      try {
        const result = await callbacks.onFill!();
        renderResults(result);
        stage = 'filled';
        reviewButton.textContent = 'Filled — review the page and submit manually';
      } catch (err) {
        results.style.display = 'flex';
        results.textContent = err instanceof Error ? err.message : String(err);
        reviewButton.disabled = false;
        reviewButton.textContent = 'Fill form';
      }
    })();
  });

  function renderResults(result: AutofillResult): void {
    results.style.display = 'flex';
    results.replaceChildren();

    const line = document.createElement('div');
    line.className = 'ok';
    line.textContent = `${result.filledCount} filled · ${result.needsReviewCount} uncertain · ${result.skippedCount} skipped`;
    results.appendChild(line);

    const failed = document.createElement('div');
    failed.className = result.failedCount > 0 ? 'bad' : 'hint';
    failed.textContent =
      result.failedCount > 0
        ? `${result.failedCount} failed verification`
        : 'All fills verified in the DOM';
    results.appendChild(failed);

    if (result.errors.length > 0) {
      const list = document.createElement('ul');
      list.className = 'errors';
      for (const error of result.errors.slice(0, 8)) {
        const item = document.createElement('li');
        item.textContent = error;
        list.appendChild(item);
      }
      results.appendChild(list);
    }

    for (const field of result.fields) {
      const row = mappings.querySelector<HTMLElement>(`[data-field-id="${field.fieldId}"]`);
      const chip = row?.querySelector<HTMLElement>('[data-role="map-chip"]');
      if (!chip) continue;
      const status =
        field.status === 'filled'
          ? 'matched'
          : field.status === 'failed'
            ? 'failed'
            : field.status === 'skipped'
              ? 'skipped'
              : 'needs_review';
      chip.className = `chip ${status}`;
      chip.textContent =
        status === 'matched'
          ? 'filled'
          : status === 'failed'
            ? 'failed'
            : status === 'skipped'
              ? 'skipped'
              : 'needs review';
    }

    if (result.needsReviewCount > 0 && callbacks.onOpenReview) {
      const openReview = document.createElement('button');
      openReview.className = 'btn secondary';
      openReview.textContent = `Review ${result.needsReviewCount} fields that need input`;
      openReview.addEventListener('click', () => callbacks.onOpenReview?.());
      results.appendChild(openReview);
    }

    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Nothing is submitted for you — review the page and submit manually.';
    results.appendChild(hint);
  }

  return {
    element: host,
    destroy(): void {
      host.remove();
    },
  };
}
