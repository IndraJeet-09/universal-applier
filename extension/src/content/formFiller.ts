import type { AutofillResult, FilledField } from '@schemas/application';
import type { FillPlan, PlannedFill } from '../intelligence/fillPlanner';
import type { MatchMethod } from '../intelligence/fieldClassifier';
import { normalizeText } from '../intelligence/taxonomy';
import { getFieldById, getFieldByFingerprint, type RegistryEntry } from './fieldRegistry';
import { cssEscape } from '../utils/dom';
import { createLogger } from '../utils/logger';

const log = createLogger('filler');

export interface FileToUpload {
  name: string;
  data: Uint8Array;
  type?: string;
}

export interface ExecuteOptions {
  resumeFile?: FileToUpload;
}

const HIGHLIGHT_STYLE_ID = 'ua-autofill-styles';

const CSS = `
[data-ua-highlight="filled"] { outline: 2px solid #16a34a !important; outline-offset: 1px; }
[data-ua-highlight="review"] { outline: 2px solid #f59e0b !important; outline-offset: 1px; background-color: rgba(245, 158, 11, 0.10) !important; }
[data-ua-pending="true"] { outline: 2px dashed #f59e0b !important; outline-offset: 1px; }
`;

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(HIGHLIGHT_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = HIGHLIGHT_STYLE_ID;
  style.textContent = CSS;
  (document.head ?? document.documentElement).appendChild(style);
}

export function clearFillMarks(): void {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('[data-ua-highlight], [data-ua-pending]').forEach((el) => {
    el.removeAttribute('data-ua-highlight');
    el.removeAttribute('data-ua-pending');
  });
}

function dispatchFieldEvents(el: Element, extra = false): void {
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  if (extra) el.dispatchEvent(new Event('blur', { bubbles: true }));
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  if (descriptor?.set) {
    descriptor.set.call(el, value);
  } else {
    (el as HTMLInputElement).value = value;
  }
  dispatchFieldEvents(el, true);
}

function labelTextFor(radio: HTMLInputElement): string {
  const wrapper = radio.closest('label');
  if (wrapper) return (wrapper.textContent ?? '').trim();
  const id = radio.id;
  if (id) {
    try {
      const labelled = document.querySelector(`label[for="${cssEscape(id)}"]`);
      if (labelled) return (labelled.textContent ?? '').trim();
    } catch {
      /* invalid selector */
    }
  }
  return radio.getAttribute('aria-label') ?? '';
}

function fillRadioGroup(el: HTMLInputElement, value: string): void {
  const desired = normalizeText(value);
  const group = el.name
    ? Array.from(
        (el.form ?? document).querySelectorAll<HTMLInputElement>(
          `input[type="radio"][name="${cssEscape(el.name)}"]`
        )
      )
    : [el];

  const matches = (radio: HTMLInputElement): boolean => {
    const label = normalizeText(labelTextFor(radio));
    const option = normalizeText(radio.value);
    return (
      option === desired ||
      label === desired ||
      (desired.length > 0 && (label.includes(desired) || option.includes(desired)))
    );
  };

  const target = group.find(matches);
  if (!target) {
    throw new Error(`no radio option matches "${value}"`);
  }
  target.click();
  target.dispatchEvent(new Event('change', { bubbles: true }));
}

function fillSelect(el: HTMLSelectElement, value: string): void {
  const desired = normalizeText(value);
  const index = Array.from(el.options).findIndex((option) => {
    const text = normalizeText(option.textContent ?? '');
    const optionValue = normalizeText(option.value);
    return (
      text === desired ||
      optionValue === desired ||
      (desired.length > 0 && (text.includes(desired) || optionValue.includes(desired)))
    );
  });
  if (index === -1) {
    throw new Error(`no select option matches "${value}"`);
  }
  el.selectedIndex = index;
  dispatchFieldEvents(el);
}

function fillCheckbox(el: HTMLInputElement, value: string, labelText: string): void {
  const desired = normalizeText(value);
  const truthy = ['yes', 'true', '1', 'on', 'checked', 'agree'].includes(desired);
  const labelMatch = labelText.length > 0 && normalizeText(labelText).includes(desired);
  if (!truthy && !labelMatch) {
    throw new Error(`checkbox value "${value}" does not match this option`);
  }
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');
  if (descriptor?.set) descriptor.set.call(el, true);
  else el.checked = true;
  dispatchFieldEvents(el);
}

function uploadFile(el: Element, file: FileToUpload): void {
  if (!(el instanceof HTMLInputElement) || el.type !== 'file') {
    throw new Error('target is not a file input');
  }
  const DataTransferCtor = (globalThis as { DataTransfer?: typeof DataTransfer }).DataTransfer;
  if (!DataTransferCtor) {
    throw new Error('file upload is not supported in this environment');
  }
  const transfer = new DataTransferCtor();
  transfer.items.add(
    new File([file.data.buffer as ArrayBuffer], file.name, { type: file.type ?? 'application/pdf' })
  );
  el.files = transfer.files;
  dispatchFieldEvents(el, true);
}

function resolveEntry(action: PlannedFill): RegistryEntry | undefined {
  return (
    getFieldById(action.fieldId) ??
    (action.fingerprint ? getFieldByFingerprint(action.fingerprint) : undefined)
  );
}

function toFillMethod(action: PlannedFill): FilledField['method'] {
  if (action.valueSource === 'ai_generated') return 'ai';
  const method: MatchMethod = action.classification.method;
  switch (method) {
    case 'ai':
      return 'ai';
    case 'cache':
      return 'cache';
    case 'exact_synonym':
    case 'phrase_contained':
      return 'synonym';
    case 'heuristic':
      return 'heuristic';
    default:
      return 'deterministic';
  }
}

function applyFill(action: PlannedFill, entry: RegistryEntry, options: ExecuteOptions): void {
  const el = entry.element;

  if (action.kind === 'file') {
    if (!options.resumeFile) {
      throw new Error('no resume file provided');
    }
    uploadFile(el, options.resumeFile);
    return;
  }

  if (action.value === null) {
    throw new Error('no value to fill');
  }

  if (el instanceof HTMLSelectElement) {
    fillSelect(el, action.value);
    return;
  }
  if (el instanceof HTMLInputElement && el.type === 'radio') {
    fillRadioGroup(el, action.value);
    return;
  }
  if (el instanceof HTMLInputElement && el.type === 'checkbox') {
    fillCheckbox(el, action.value, entry.field.label ?? '');
    return;
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    setNativeValue(el, action.value);
    return;
  }
  throw new Error(`unsupported element type ${String(el.constructor?.name)}`);
}

function markElement(entry: RegistryEntry, action: PlannedFill): void {
  const el = entry.element;
  if (!(el instanceof HTMLElement)) return;
  if (action.decision === 'auto_fill') {
    el.setAttribute('data-ua-highlight', 'filled');
  } else if (action.decision === 'fill_highlight') {
    el.setAttribute('data-ua-highlight', 'review');
  } else if (action.decision === 'ask_user') {
    el.setAttribute('data-ua-pending', 'true');
  }
}

function record(
  action: PlannedFill,
  status: FilledField['status'],
  error?: string
): FilledField {
  return {
    fieldId: action.fieldId,
    semanticField: action.semanticField,
    value: action.value ?? '',
    confidence: action.confidence,
    method: toFillMethod(action),
    status,
    timestamp: new Date().toISOString(),
    ...(error ? { error } : {}),
  };
}

export function applyUserEdit(action: PlannedFill, value: string): FilledField {
  ensureStyles();
  const entry = resolveEntry(action);
  if (!entry) {
    const error = 'field element not found (page may have changed)';
    log.warn('user edit failed', { field: action.semanticField, error });
    return record(action, 'failed', error);
  }

  const modified: PlannedFill = { ...action, value, decision: 'auto_fill' };
  try {
    applyFill(modified, entry, {});
    entry.element.setAttribute('data-ua-highlight', 'filled');
    return { ...record(modified, 'success'), method: 'user' };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.warn('user edit failed', { field: action.semanticField, error });
    return record(action, 'failed', error);
  }
}

export function executeFillPlan(plan: FillPlan, options: ExecuteOptions = {}): AutofillResult {
  ensureStyles();

  const fields: FilledField[] = [];
  const errors: string[] = [];
  let filledCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let needsReviewCount = 0;

  for (const action of plan.actions) {
    if (action.decision === 'skip') {
      fields.push(record(action, 'skipped'));
      skippedCount += 1;
      continue;
    }

    if (action.decision === 'ask_user') {
      fields.push(record(action, 'needs_review'));
      needsReviewCount += 1;
      const entry = resolveEntry(action);
      if (entry) markElement(entry, action);
      continue;
    }

    const entry = resolveEntry(action);
    if (!entry) {
      const error = 'field element not found (page may have changed)';
      fields.push(record(action, 'failed', error));
      errors.push(`${action.semanticField}: ${error}`);
      failedCount += 1;
      continue;
    }

    try {
      applyFill(action, entry, options);
      markElement(entry, action);
      if (action.decision === 'fill_highlight') {
        fields.push(record(action, 'needs_review'));
        needsReviewCount += 1;
      } else {
        fields.push(record(action, 'success'));
        filledCount += 1;
      }
      log.debug('filled', { field: action.semanticField, value: action.value });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      fields.push(record(action, 'failed', error));
      errors.push(`${action.semanticField}: ${error}`);
      failedCount += 1;
      log.warn('fill failed', { field: action.semanticField, error });
    }
  }

  return {
    success: failedCount === 0,
    filledCount,
    failedCount,
    skippedCount,
    needsReviewCount,
    fields,
    errors,
  };
}
