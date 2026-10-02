import type { FillPlan, PlannedFill } from '../intelligence/fillPlanner';
import { applyUserEdit } from './formFiller';
import type { FilledField } from '@schemas/application';

export interface ReviewPanelCallbacks {
  onApply?: (action: PlannedFill, value: string) => FilledField | Promise<FilledField>;
  onDismiss?: (action: PlannedFill) => void;
  onClose?: () => void;
}

export interface ReviewPanel {
  element: HTMLElement;
  destroy(): void;
}

const STYLES = `
:host { all: initial; }
.panel {
  position: fixed; top: 16px; right: 16px; z-index: 2147483646;
  width: 360px; max-height: calc(100vh - 32px); display: flex; flex-direction: column;
  background: #ffffff; color: #111827; border: 1px solid #e5e7eb; border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0,0,0,.18); font: 13px/1.4 system-ui, sans-serif;
  overflow: hidden;
}
.header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 12px; border-bottom: 1px solid #e5e7eb; background: #f9fafb;
}
.header h2 { margin: 0; font-size: 13px; font-weight: 600; }
.count { color: #6b7280; font-weight: 400; }
.close { border: 0; background: transparent; cursor: pointer; font-size: 16px; color: #6b7280; padding: 0 4px; }
.close:hover { color: #111827; }
.list { overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 8px; }
.item { border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px; background: #fff; }
.item.applied { border-color: #16a34a; background: #f0fdf4; }
.item.dismissed { opacity: .55; }
.item-head { display: flex; align-items: baseline; justify-content: space-between; gap: 6px; }
.label { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.badges { display: flex; gap: 4px; flex-shrink: 0; }
.badge { font-size: 10px; border-radius: 999px; padding: 1px 6px; background: #f3f4f6; color: #374151; }
.badge.high { background: #dcfce7; color: #166534; }
.badge.medium { background: #fef3c7; color: #92400e; }
.badge.low { background: #fee2e2; color: #991b1b; }
.badge.sensitive { background: #ede9fe; color: #5b21b6; }
.reason { color: #6b7280; font-size: 11px; margin: 4px 0 6px; }
.value {
  width: 100%; box-sizing: border-box; border: 1px solid #d1d5db; border-radius: 6px;
  padding: 6px 8px; font: inherit; resize: vertical; min-height: 30px; color: #111827;
}
.value:focus { outline: 2px solid #3b82f6; outline-offset: -1px; }
.value:disabled { background: #f9fafb; }
.actions { display: flex; gap: 6px; margin-top: 6px; }
.btn {
  border: 0; border-radius: 6px; padding: 5px 10px; font: inherit; font-weight: 600;
  cursor: pointer; background: #2563eb; color: #fff;
}
.btn:hover { background: #1d4ed8; }
.btn:disabled { background: #9ca3af; cursor: default; }
.btn.secondary { background: #e5e7eb; color: #374151; }
.btn.secondary:hover { background: #d1d5db; }
.empty { padding: 16px; color: #6b7280; text-align: center; }
.status { margin-left: auto; color: #16a34a; font-weight: 600; font-size: 12px; }
`;

function confidenceBadge(action: PlannedFill): { cls: string; text: string } {
  const pct = Math.round(action.confidence * 100);
  const cls = action.confidence >= 0.95 ? 'high' : action.confidence >= 0.8 ? 'medium' : 'low';
  return { cls, text: `${pct}%` };
}

function reviewableActions(plan: FillPlan): PlannedFill[] {
  return plan.actions.filter(
    (a) => a.decision === 'ask_user' || a.decision === 'fill_highlight'
  );
}

export function createReviewPanel(
  plan: FillPlan,
  callbacks: ReviewPanelCallbacks = {}
): ReviewPanel {
  const actions = reviewableActions(plan);
  const apply = callbacks.onApply ?? applyUserEdit;

  const host = document.createElement('div');
  host.id = 'ua-review-panel';
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
  title.textContent = 'Review suggested fills';
  const count = document.createElement('span');
  count.className = 'count';
  const close = document.createElement('button');
  close.className = 'close';
  close.setAttribute('aria-label', 'Close review panel');
  close.textContent = '×';
  header.append(title, count, close);
  panel.appendChild(header);

  const list = document.createElement('div');
  list.className = 'list';
  panel.appendChild(list);

  let applied = 0;
  let dismissed = 0;

  function refreshCount(): void {
    const remaining = actions.length - applied - dismissed;
    count.textContent = `${remaining} remaining`;
  }

  close.addEventListener('click', () => {
    callbacks.onClose?.();
    host.remove();
  });

  if (actions.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No fields need review.';
    list.appendChild(empty);
  }

  for (const action of actions) {
    const item = document.createElement('div');
    item.className = 'item';

    const head = document.createElement('div');
    head.className = 'item-head';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = action.review?.label || action.semanticField;
    label.title = action.semanticField;
    const badges = document.createElement('div');
    badges.className = 'badges';
    if (action.sensitive) {
      const sensitive = document.createElement('span');
      sensitive.className = 'badge sensitive';
      sensitive.textContent = 'sensitive';
      badges.appendChild(sensitive);
    }
    const badge = confidenceBadge(action);
    const confidence = document.createElement('span');
    confidence.className = `badge ${badge.cls}`;
    confidence.textContent = badge.text;
    badges.appendChild(confidence);
    head.append(label, badges);

    const reason = document.createElement('div');
    reason.className = 'reason';
    reason.textContent = action.reason;

    const input = document.createElement('textarea');
    input.className = 'value';
    input.rows = action.value && action.value.length > 60 ? 3 : 1;
    input.value = action.value ?? '';
    input.placeholder = action.sensitive ? 'Enter a value yourself' : 'Suggested value';

    const buttons = document.createElement('div');
    buttons.className = 'actions';
    const fillButton = document.createElement('button');
    fillButton.className = 'btn';
    fillButton.textContent = 'Fill';
    fillButton.disabled = input.value.trim().length === 0;
    const status = document.createElement('span');
    status.className = 'status';
    const dismissButton = document.createElement('button');
    dismissButton.className = 'btn secondary';
    dismissButton.textContent = 'Skip';
    buttons.append(fillButton, dismissButton, status);

    input.addEventListener('input', () => {
      fillButton.disabled = input.value.trim().length === 0;
    });

    fillButton.addEventListener('click', () => {
      const value = input.value.trim();
      if (!value) return;
      fillButton.disabled = true;
      status.style.color = '';
      status.textContent = 'Filling…';
      void Promise.resolve(apply(action, value))
        .then((result) => {
          if (result.status === 'filled') {
            action.value = value;
            action.decision = 'auto_fill';
            item.classList.add('applied');
            item.classList.remove('dismissed');
            input.disabled = true;
            fillButton.disabled = true;
            dismissButton.disabled = true;
            status.textContent = 'Filled ✓';
            applied += 1;
            refreshCount();
          } else {
            status.textContent = result.error ? `Failed: ${result.error}` : 'Failed';
            status.style.color = '#dc2626';
            fillButton.disabled = false;
          }
        })
        .catch((err: unknown) => {
          status.textContent = err instanceof Error ? err.message : String(err);
          status.style.color = '#dc2626';
          fillButton.disabled = false;
        });
    });

    dismissButton.addEventListener('click', () => {
      if (item.classList.contains('applied')) return;
      action.decision = 'skip';
      item.classList.add('dismissed');
      input.disabled = true;
      fillButton.disabled = true;
      dismissButton.disabled = true;
      status.textContent = 'Skipped';
      status.style.color = '#6b7280';
      dismissed += 1;
      callbacks.onDismiss?.(action);
      refreshCount();
    });

    item.append(head, reason, input, buttons);
    list.appendChild(item);
  }

  refreshCount();

  return {
    element: host,
    destroy(): void {
      host.remove();
    },
  };
}
