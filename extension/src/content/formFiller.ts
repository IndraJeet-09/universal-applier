import type { AutofillResult, FilledField } from '@schemas/application';
import type { FillPlan, PlannedFill } from '../intelligence/fillPlanner';
import type { MatchMethod } from '../intelligence/fieldClassifier';
import { normalizeText, isLegalDeclaration } from '../intelligence/taxonomy';
import { matchOption, optionMeaning } from '../intelligence/candidateMatcher';
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
  /**
   * fingerprint → value filled earlier in this session. Fields already filled
   * with the planned value are skipped instead of being written again, which
   * keeps rescans and multi-step forms from reprocessing the same field.
   */
  history?: Map<string, string>;
}

/**
 * Write strategies for text-like controls, tried in order when verification
 * fails. Strategies never loop indefinitely — at most MAX_ATTEMPTS per field.
 */
export type FillStrategy = 'native' | 'tracked' | 'direct';
const MAX_ATTEMPTS = 3;
const TEXT_STRATEGIES: FillStrategy[] = ['native', 'tracked', 'direct'];

const HIGHLIGHT_STYLE_ID = 'ua-autofill-styles';

const CSS = `
[data-ua-highlight="filled"] { outline: 2px solid #16a34a !important; outline-offset: 1px; }
[data-ua-highlight="review"] { outline: 2px solid #f59e0b !important; outline-offset: 1px; background-color: rgba(245, 158, 11, 0.10) !important; }
[data-ua-highlight="failed"] { outline: 2px solid #dc2626 !important; outline-offset: 1px; background-color: rgba(220, 38, 38, 0.10) !important; }
[data-ua-highlight="skipped"] { outline: 2px solid #9ca3af !important; outline-offset: 1px; }
[data-ua-pending="true"] { outline: 2px dashed #f59e0b !important; outline-offset: 1px; }
`;

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(HIGHLIGHT_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = HIGHLIGHT_STYLE_ID;
  style.textContent = CSS;
  (document.head ?? document.documentElement).appendChild(style);
}

/**
 * Highlights are temporary: the page keeps no permanent styling of ours. Once
 * every mark is cleared, the injected stylesheet is removed as well.
 */
export function clearFillMarks(): void {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('[data-ua-highlight], [data-ua-pending]').forEach((el) => {
    el.removeAttribute('data-ua-highlight');
    el.removeAttribute('data-ua-pending');
  });
  const style = document.getElementById(HIGHLIGHT_STYLE_ID);
  if (style && !document.querySelector('[data-ua-highlight], [data-ua-pending]')) {
    style.remove();
  }
}

let expiryTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleHighlightExpiry(ms = 8000): void {
  if (typeof setTimeout !== 'function') return;
  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = setTimeout(() => {
    expiryTimer = null;
    clearFillMarks();
  }, ms);
  const timer = expiryTimer as unknown as { unref?: () => void };
  if (typeof timer.unref === 'function') timer.unref();
}

function scopeRoot(el: Element): Document | ShadowRoot | Element {
  const node = el.getRootNode();
  if (node instanceof Document || node instanceof ShadowRoot) return node;
  return el.ownerDocument;
}

function descriptorFor(el: Element): PropertyDescriptor | undefined {
  if (el instanceof HTMLTextAreaElement) {
    return Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
  }
  if (el instanceof HTMLSelectElement) {
    return Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  }
  if (el instanceof HTMLInputElement) {
    return Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  }
  return undefined;
}

function dispatchFieldEvents(el: Element): void {
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function dispatchBlur(el: Element): void {
  if (el instanceof HTMLElement && el.ownerDocument.activeElement === el) {
    el.blur();
    return;
  }
  el.dispatchEvent(new Event('blur', { bubbles: false }));
  el.dispatchEvent(new Event('focusout', { bubbles: true }));
}

/**
 * React tracks writes made through the instance `value` property and silently
 * swallows the resulting change event. Resetting the tracker (and writing via
 * the prototype setter) is what makes controlled inputs accept the value.
 */
function resetValueTracker(el: HTMLInputElement | HTMLTextAreaElement): void {
  const tracker = (
    el as unknown as { _valueTracker?: { setValue(value: string): void } }
  )._valueTracker;
  tracker?.setValue('');
}

function writeTextValue(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
  strategy: FillStrategy
): void {
  el.focus();
  const descriptor = descriptorFor(el);

  if (strategy === 'direct') {
    resetValueTracker(el);
    (el as HTMLInputElement).value = value;
  } else {
    if (strategy === 'tracked') resetValueTracker(el);
    if (descriptor?.set) descriptor.set.call(el, value);
    else (el as HTMLInputElement).value = value;
  }

  dispatchFieldEvents(el);
  dispatchBlur(el);
}

function labelTextFor(control: Element): string {
  const wrapper = control.closest('label');
  if (wrapper) {
    const clone = wrapper.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('input, textarea, select, button').forEach((n) => n.remove());
    const text = (clone.textContent ?? '').trim();
    if (text) return text;
  }
  const id = control.getAttribute('id');
  if (id) {
    try {
      const root = scopeRoot(control);
      const labelled =
        'querySelector' in root
          ? root.querySelector(`label[for="${cssEscape(id)}"]`)
          : null;
      const text = (labelled?.textContent ?? '').trim();
      if (text) return text;
    } catch {
      /* invalid selector */
    }
  }
  return control.getAttribute('aria-label') ?? '';
}

interface SemanticError extends Error {
  retryable?: boolean;
}

function semanticError(message: string): SemanticError {
  const err = new Error(message) as SemanticError;
  err.retryable = false;
  return err;
}

function radiosInGroup(radio: HTMLInputElement): HTMLInputElement[] {
  const root = scopeRoot(radio);
  if (!radio.name) return [radio];
  try {
    const found = root.querySelectorAll<HTMLInputElement>(
      `input[type="radio"][name="${cssEscape(radio.name)}"]`
    );
    if (found.length > 0) return Array.from(found);
  } catch {
    /* invalid selector */
  }
  if (radio.form) {
    return Array.from(radio.form.querySelectorAll<HTMLInputElement>(
      `input[type="radio"][name="${cssEscape(radio.name)}"]`
    ));
  }
  return [radio];
}

/**
 * Does this radio option mean the requested answer? Labels decide — a
 * `value="1"` on its own never tells us whether it is the "Yes" option.
 */
function radioMatches(radio: HTMLInputElement, desired: string): boolean {
  const desiredNorm = normalizeText(desired);
  if (!desiredNorm) return false;

  const labelText = labelTextFor(radio);
  const candidates = [labelText, radio.value, radio.getAttribute('aria-label') ?? '']
    .map((t) => normalizeText(t))
    .filter((t) => t.length > 0);

  if (candidates.some((t) => t === desiredNorm)) return true;

  const desiredMeaning = optionMeaning(desired, true);
  if (desiredMeaning) {
    for (const source of [labelText, radio.value]) {
      if (optionMeaning(source, true) === desiredMeaning) return true;
    }
  }

  if (desiredNorm.length >= 3 && candidates.some((t) => t.includes(desiredNorm))) return true;
  return false;
}

function fillRadioGroup(el: HTMLInputElement, value: string): void {
  const group = radiosInGroup(el);
  const target = group.find((radio) => radioMatches(radio, value));
  if (!target) {
    throw semanticError(`no radio option matches "${value}"`);
  }
  const alreadyChecked = group.filter((radio) => radio.checked);
  if (alreadyChecked.length === 1 && alreadyChecked[0] === target) return;

  target.focus();
  if (!target.checked) target.click();
  target.checked = true;
  dispatchFieldEvents(target);
  dispatchBlur(target);
}

function selectedOptionText(el: HTMLSelectElement): string {
  const option = el.selectedOptions?.[0];
  if (!option) return '';
  const text = (option.textContent ?? '').trim();
  return text.length > 0 ? text : option.value;
}

function fillSelect(el: HTMLSelectElement, value: string): void {
  const labels = Array.from(el.options).map((o) => (o.textContent ?? '').trim());
  const targetLabel = matchOption(labels, value);
  const byValue = targetLabel
    ? null
    : Array.from(el.options).find(
        (o) => normalizeText(o.value) === normalizeText(value)
      )?.textContent?.trim() ?? null;
  const chosen = targetLabel ?? byValue;
  if (!chosen) {
    throw semanticError(`no select option matches "${value}"`);
  }

  const option = Array.from(el.options).find(
    (o) => (o.textContent ?? '').trim() === chosen || o.value === chosen
  );
  if (!option) throw semanticError(`no select option matches "${value}"`);

  el.focus();
  const descriptor = descriptorFor(el);
  if (descriptor?.set) descriptor.set.call(el, option.value);
  else el.value = option.value;
  if (el.selectedOptions[0] !== option) el.selectedIndex = option.index;

  dispatchFieldEvents(el);
  dispatchBlur(el);
}

const TRUTHY = ['yes', 'true', '1', 'on', 'checked', 'agree', 'accept', 'confirm'];
const FALSY = ['no', 'false', '0', 'off', 'unchecked', 'decline', 'disagree'];

/**
 * What should the checkbox state be for this value? Falls back to "the label
 * repeats the value" (e.g. a "Remote work" checkbox filled with `remote`).
 */
function resolveCheckboxDesired(value: string, labelText: string): boolean | null {
  const desiredNorm = normalizeText(value);
  if (TRUTHY.includes(desiredNorm)) return true;
  if (FALSY.includes(desiredNorm)) return false;
  if (desiredNorm.length > 0 && labelText && normalizeText(labelText).includes(desiredNorm)) {
    return true;
  }
  return null;
}

function fillCheckbox(
  el: HTMLInputElement,
  value: string,
  labelText: string,
  userConfirmed: boolean
): void {
  if (isLegalDeclaration(labelText) && !userConfirmed) {
    throw semanticError('legal declaration requires user confirmation');
  }

  const desired = resolveCheckboxDesired(value, labelText);
  if (desired === null) {
    throw semanticError(`checkbox value "${value}" does not match this option`);
  }

  el.focus();
  if (el.checked !== desired) {
    // A real click runs the widget's activation behaviour and satisfies
    // frameworks (React) that only listen for click on checkboxes.
    el.click();
  }
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');
  if (descriptor?.set && el.checked !== desired) descriptor.set.call(el, desired);
  else if (el.checked !== desired) el.checked = desired;

  dispatchFieldEvents(el);
  dispatchBlur(el);
}

function findByIdInScope(el: Element, id: string): Element | null {
  const node = el.getRootNode();
  try {
    if (node instanceof Document || node instanceof ShadowRoot) {
      return node.getElementById(id);
    }
  } catch {
    /* invalid id */
  }
  try {
    return el.ownerDocument.getElementById(id);
  } catch {
    return null;
  }
}

function findOpenOptionElements(el: Element): HTMLElement[] {
  const roots: ParentNode[] = [];
  const controlledId =
    el.getAttribute('aria-controls') ?? el.getAttribute('aria-owns') ?? undefined;
  if (controlledId) {
    const target = findByIdInScope(el, controlledId);
    // The widget owns its menu: only that container counts as "open".
    if (target) roots.push(target);
    else return [];
  } else {
    roots.push(scopeRoot(el));
    if (el.parentElement) roots.push(el.parentElement);
  }

  const seen = new Set<HTMLElement>();
  for (const root of roots) {
    if (typeof root.querySelectorAll !== 'function') continue;
    const nodes = root.querySelectorAll<HTMLElement>(
      '[role="option"], [role="treeitem"], [data-value]'
    );
    for (const node of nodes) {
      if (seen.has(node)) continue;
      if (node.getAttribute('aria-hidden') === 'true') continue;
      // A closed menu keeps its options in the DOM — they are not "open".
      if (node.closest('[hidden]')) continue;
      seen.add(node);
    }
  }
  return Array.from(seen);
}

function tick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function fillCustomDropdown(el: HTMLElement, value: string): Promise<void> {
  let options = findOpenOptionElements(el);

  if (options.length === 0) {
    el.focus();
    el.dispatchEvent(new Event('focus', { bubbles: true }));
    el.dispatchEvent(new Event('mousedown', { bubbles: true }));
    el.click();
    await tick();
    await tick();
    options = findOpenOptionElements(el);
  }

  if (options.length === 0) {
    throw semanticError('custom dropdown did not expose any options');
  }

  const labels = options.map((o) => normalizeText(o.textContent ?? ''));
  const desired = normalizeText(value);
  let index = labels.findIndex((label) => label === desired);
  if (index === -1) {
    const matched = matchOption(
      options.map((o) => (o.textContent ?? '').trim()),
      value
    );
    if (matched) index = options.findIndex((o) => (o.textContent ?? '').trim() === matched);
  }
  if (index === -1) {
    const desiredMeaning = optionMeaning(value, true);
    if (desiredMeaning) {
      index = labels.findIndex(
        (label, i) =>
          optionMeaning(label, true) === desiredMeaning ||
          optionMeaning(options[i].getAttribute('data-value') ?? '', true) === desiredMeaning
      );
    }
  }
  if (index === -1) throw semanticError(`no dropdown option matches "${value}"`);

  const target = options[index];
  target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  target.click();
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await tick();
}

function fillContenteditable(el: HTMLElement, value: string, strategy: FillStrategy): void {
  el.focus();
  if (strategy === 'tracked') resetValueTracker(el as unknown as HTMLInputElement);
  el.textContent = value;
  dispatchFieldEvents(el);
  dispatchBlur(el);
}

function uploadFile(el: Element, file: FileToUpload): void {
  if (!(el instanceof HTMLInputElement) || el.type !== 'file') {
    throw semanticError('target is not a file input');
  }
  const DataTransferCtor = (globalThis as { DataTransfer?: typeof DataTransfer }).DataTransfer;
  if (!DataTransferCtor) {
    throw semanticError('file upload is not supported in this environment');
  }
  const transfer = new DataTransferCtor();
  transfer.items.add(
    new File([file.data.buffer as ArrayBuffer], file.name, { type: file.type ?? 'application/pdf' })
  );
  el.files = transfer.files;
  dispatchFieldEvents(el);
  dispatchBlur(el);
}

type ApplyResult = { ok: true } | { ok: false; error: string; retryable: boolean };

function applyFailed(error: unknown): ApplyResult {
  const message = error instanceof Error ? error.message : String(error);
  const retryable = (error as SemanticError | undefined)?.retryable !== false;
  return { ok: false, error: message, retryable };
}

async function applyFill(
  action: PlannedFill,
  entry: RegistryEntry,
  options: ExecuteOptions,
  strategy: FillStrategy,
  userConfirmed: boolean
): Promise<ApplyResult> {
  const el = entry.element;

  try {
    if (action.kind === 'file') {
      if (!options.resumeFile) throw semanticError('no resume file provided');
      uploadFile(el, options.resumeFile);
      return { ok: true };
    }

    if (action.value === null) throw semanticError('no value to fill');

    if (el instanceof HTMLSelectElement) {
      fillSelect(el, action.value);
      return { ok: true };
    }
    if (el instanceof HTMLInputElement && el.type === 'radio') {
      fillRadioGroup(el, action.value);
      return { ok: true };
    }
    if (el instanceof HTMLInputElement && el.type === 'checkbox') {
      fillCheckbox(el, action.value, entry.field.label ?? '', userConfirmed);
      return { ok: true };
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      writeTextValue(el, action.value, strategy);
      return { ok: true };
    }

    const role = el.getAttribute('role');
    const editable =
      el instanceof HTMLElement &&
      (el.isContentEditable ||
        el.getAttribute('contenteditable') === 'true' ||
        role === 'textbox' ||
        role === 'searchbox' ||
        role === 'spinbutton');
    if (editable) {
      fillContenteditable(el, action.value, strategy);
      return { ok: true };
    }
    if (el instanceof HTMLElement && (role === 'combobox' || role === 'listbox')) {
      await fillCustomDropdown(el, action.value);
      return { ok: true };
    }

    throw semanticError(`unsupported element type ${String(el.constructor?.name)}`);
  } catch (err) {
    return applyFailed(err);
  }
}

interface Verdict {
  ok: boolean;
  error?: string;
}

function normalizeForCompare(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function valuesMatch(intended: string, actual: string): boolean {
  const a = normalizeForCompare(intended);
  const b = normalizeForCompare(actual);
  if (a === b) return true;
  if (a.length > 0 && b.length > 0 && a.toLowerCase() === b.toLowerCase()) return true;
  return false;
}

/**
 * Verification: the intended value → what the DOM actually holds right now.
 * A field is only reported as FILLED when the read-back matches.
 */
function verifyFill(action: PlannedFill, entry: RegistryEntry, options: ExecuteOptions): Verdict {
  const el = entry.element;

  if (action.kind === 'file') {
    if (!options.resumeFile) return { ok: false, error: 'no resume file provided' };
    if (!(el instanceof HTMLInputElement) || el.type !== 'file') {
      return { ok: false, error: 'target is not a file input' };
    }
    const file = el.files?.[0];
    if (!file || el.files?.length !== 1) return { ok: false, error: 'no file attached to input' };
    if (file.name !== options.resumeFile.name) {
      return { ok: false, error: `attached "${file.name}" instead of "${options.resumeFile.name}"` };
    }
    return { ok: true };
  }

  if (action.value === null) return { ok: false, error: 'no value to fill' };
  const intended = action.value;

  if (el instanceof HTMLSelectElement) {
    const selected = selectedOptionText(el);
    if (!selected) return { ok: false, error: 'no option selected after fill' };
    const semanticHit =
      normalizeText(selected) === normalizeText(intended) ||
      matchOption([selected], intended) !== null;
    if (!semanticHit) {
      return { ok: false, error: `selected "${selected}" does not match "${intended}"` };
    }
    return { ok: true };
  }

  if (el instanceof HTMLInputElement && el.type === 'radio') {
    const group = radiosInGroup(el);
    const target = group.find((radio) => radioMatches(radio, intended));
    if (!target) return { ok: false, error: `no radio option matches "${intended}"` };
    if (!target.checked) return { ok: false, error: 'radio option is not checked after fill' };
    const wronglyChecked = group.filter((radio) => radio.checked && radio !== target);
    if (wronglyChecked.length > 0) {
      return { ok: false, error: 'a different radio option is still checked' };
    }
    return { ok: true };
  }

  if (el instanceof HTMLInputElement && el.type === 'checkbox') {
    const desired = resolveCheckboxDesired(intended, entry.field.label ?? '');
    if (desired === null) {
      return { ok: false, error: `checkbox value "${intended}" does not match this option` };
    }
    if (el.checked !== desired) {
      return { ok: false, error: `checkbox is ${el.checked ? 'checked' : 'unchecked'} after fill` };
    }
    return { ok: true };
  }

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (el.value === '') {
      return { ok: false, error: 'value was cleared by the page after fill' };
    }
    if (!valuesMatch(action.value, el.value)) {
      return { ok: false, error: `DOM holds "${el.value}" instead of "${action.value}"` };
    }
    return { ok: true };
  }

  if (el instanceof HTMLElement) {
    const role = el.getAttribute('role');
    if (
      el.isContentEditable ||
      el.getAttribute('contenteditable') === 'true' ||
      role === 'textbox' ||
      role === 'searchbox' ||
      role === 'spinbutton'
    ) {
      if (!valuesMatch(action.value, el.textContent ?? '')) {
        return { ok: false, error: 'contenteditable does not hold the intended text' };
      }
      return { ok: true };
    }
    if (role === 'combobox' || role === 'listbox') {
      const shown = normalizeText(el.textContent ?? '');
      const wanted = normalizeText(action.value);
      if (shown.includes(wanted)) return { ok: true };
      return { ok: false, error: `dropdown shows "${shown}" instead of "${wanted}"` };
    }
  }

  return { ok: false, error: `unsupported element type ${String(el.constructor?.name)}` };
}

/** Let the framework re-render (state → DOM) before reading the value back. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function isTextControl(entry: RegistryEntry): boolean {
  const el = entry.element;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    return !['radio', 'checkbox', 'file', 'button', 'submit', 'reset', 'image'].includes(el.type);
  }
  if (el instanceof HTMLElement) {
    const role = el.getAttribute('role');
    return (
      el.isContentEditable ||
      el.getAttribute('contenteditable') === 'true' ||
      role === 'textbox' ||
      role === 'searchbox' ||
      role === 'spinbutton'
    );
  }
  return false;
}

interface FillOutcome {
  ok: boolean;
  error?: string;
  attempts: number;
}

async function fillWithVerification(
  action: PlannedFill,
  entry: RegistryEntry,
  options: ExecuteOptions,
  userConfirmed = false
): Promise<FillOutcome> {
  const retryable = isTextControl(entry);
  const maxAttempts = retryable ? MAX_ATTEMPTS : 1;
  let lastError = 'fill was not attempted';
  let attempts = 0;

  for (let i = 0; i < maxAttempts; i++) {
    attempts = i + 1;
    const strategy = retryable ? TEXT_STRATEGIES[i] : 'native';
    const applied = await applyFill(action, entry, options, strategy, userConfirmed);
    if (!applied.ok) {
      lastError = applied.error;
      if (!applied.retryable) break;
      continue;
    }

    await settle();
    const verdict = verifyFill(action, entry, options);
    if (verdict.ok) {
      if (attempts > 1) {
        log.debug('filled after retry', {
          field: action.semanticField,
          attempts,
          strategy,
        });
      }
      return { ok: true, attempts };
    }
    lastError = verdict.error ?? 'verification failed';
    if (!retryable) break;
  }

  return { ok: false, error: lastError, attempts };
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

type HighlightKind = 'filled' | 'review' | 'failed' | 'skipped';

function markElement(entry: RegistryEntry, kind: HighlightKind): void {
  const el = entry.element;
  if (!(el instanceof HTMLElement)) return;
  el.setAttribute('data-ua-highlight', kind);
}

function markDecision(entry: RegistryEntry, action: PlannedFill): void {
  if (action.decision === 'auto_fill') markElement(entry, 'filled');
  else if (action.decision === 'fill_highlight') markElement(entry, 'review');
  else if (action.decision === 'ask_user') {
    const el = entry.element;
    if (el instanceof HTMLElement) el.setAttribute('data-ua-pending', 'true');
  } else {
    markElement(entry, 'skipped');
  }
}

function record(
  action: PlannedFill,
  status: FilledField['status'],
  extra: { error?: string; reason?: string; attempts?: number } = {}
): FilledField {
  return {
    fieldId: action.fieldId,
    semanticField: action.semanticField,
    value: action.value ?? '',
    confidence: action.confidence,
    method: toFillMethod(action),
    status,
    timestamp: new Date().toISOString(),
    ...(extra.error ? { error: extra.error } : {}),
    ...(extra.reason ? { reason: extra.reason } : {}),
    ...(extra.attempts !== undefined ? { attempts: extra.attempts } : {}),
  };
}

export async function applyUserEdit(
  action: PlannedFill,
  value: string,
  options: ExecuteOptions = {}
): Promise<FilledField> {
  ensureStyles();
  const entry = resolveEntry(action);
  if (!entry) {
    const error = 'field element not found (page may have changed)';
    log.warn('user edit failed', { field: action.semanticField, error });
    return record(action, 'failed', { error });
  }

  const modified: PlannedFill = { ...action, value, decision: 'auto_fill' };
  const outcome = await fillWithVerification(modified, entry, options, true);
  if (outcome.ok) {
    markElement(entry, 'filled');
    options.history?.set(action.fingerprint, value);
    return {
      ...record(modified, 'filled', { attempts: outcome.attempts }),
      method: 'user',
    };
  }

  markElement(entry, 'failed');
  const error = outcome.error ?? 'fill failed';
  log.warn('user edit failed', { field: action.semanticField, error });
  return record(action, 'failed', { error, attempts: outcome.attempts });
}

export async function executeFillPlan(
  plan: FillPlan,
  options: ExecuteOptions = {}
): Promise<AutofillResult> {
  ensureStyles();
  const history = options.history;

  const fields: FilledField[] = [];
  const errors: string[] = [];
  let filledCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let needsReviewCount = 0;

  for (const action of plan.actions) {
    if (action.decision === 'skip') {
      fields.push(record(action, 'skipped', { reason: action.reason }));
      skippedCount += 1;
      const entry = resolveEntry(action);
      if (entry) markElement(entry, 'skipped');
      continue;
    }

    if (action.decision === 'ask_user') {
      fields.push(record(action, 'needs_review', { reason: action.reason }));
      needsReviewCount += 1;
      const entry = resolveEntry(action);
      if (entry) markDecision(entry, action);
      continue;
    }

    if (
      history &&
      action.value !== null &&
      history.get(action.fingerprint) === action.value
    ) {
      fields.push(record(action, 'skipped', { reason: 'already filled in this session' }));
      skippedCount += 1;
      continue;
    }

    const entry = resolveEntry(action);
    if (!entry) {
      const error = 'field element not found (page may have changed)';
      fields.push(record(action, 'failed', { error }));
      errors.push(`${action.semanticField}: ${error}`);
      failedCount += 1;
      log.warn('fill failed', { field: action.semanticField, error });
      continue;
    }

    const outcome = await fillWithVerification(action, entry, options);
    if (outcome.ok) {
      if (action.value !== null) history?.set(action.fingerprint, action.value);
      markDecision(entry, action);
      if (action.decision === 'fill_highlight') {
        fields.push(record(action, 'needs_review', { attempts: outcome.attempts }));
        needsReviewCount += 1;
      } else {
        fields.push(record(action, 'filled', { attempts: outcome.attempts }));
        filledCount += 1;
      }
      log.debug('filled', { field: action.semanticField, value: action.value });
    } else {
      const error = outcome.error ?? 'fill failed';
      markElement(entry, 'failed');
      fields.push(record(action, 'failed', { error, attempts: outcome.attempts }));
      errors.push(`${action.semanticField}: ${error}`);
      failedCount += 1;
      log.warn('fill failed', { field: action.semanticField, error, attempts: outcome.attempts });
    }
  }

  scheduleHighlightExpiry();

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
