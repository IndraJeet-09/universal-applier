import type { SemanticField, PageType } from '@schemas/dom';
import { classifyField, type Classification } from '../intelligence/fieldClassifier';
import { classificationBand, bandDescription } from '../intelligence/confidence';

export interface DebugFieldEntry {
  field: SemanticField;
  classification: Classification;
}

export interface DebugPanelData {
  pageType?: PageType;
  pageConfidence?: number;
  entries: DebugFieldEntry[];
}

export interface DebugPanel {
  element: HTMLElement;
  update(data: DebugPanelData): void;
  destroy(): void;
}

export interface DebugPanelCallbacks {
  onClose?: () => void;
}

export function buildDebugData(
  fields: SemanticField[],
  page?: { pageType?: PageType; pageConfidence?: number }
): DebugPanelData {
  return {
    pageType: page?.pageType,
    pageConfidence: page?.pageConfidence,
    entries: fields.map((field) => ({ field, classification: classifyField(field) })),
  };
}

const STYLES = `
:host { all: initial; }
.panel {
  position: fixed; bottom: 16px; left: 16px; z-index: 2147483646;
  width: 380px; max-height: calc(100vh - 64px); display: flex; flex-direction: column;
  background: #0f172a; color: #e2e8f0; border: 1px solid #334155; border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0,0,0,.4); font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
  overflow: hidden;
}
.header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 10px; border-bottom: 1px solid #334155; background: #1e293b;
}
.header h2 { margin: 0; font-size: 12px; font-weight: 700; color: #f8fafc; }
.summary { color: #94a3b8; font-size: 11px; margin-top: 2px; }
.close {
  border: 0; background: transparent; cursor: pointer; font-size: 16px;
  color: #94a3b8; padding: 0 4px;
}
.close:hover { color: #f8fafc; }
.list { overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 8px; }
.item { border: 1px solid #334155; border-radius: 6px; padding: 6px 8px; background: #111c31; }
.item-head { display: flex; align-items: baseline; justify-content: space-between; gap: 6px; }
.index { color: #64748b; font-weight: 700; }
.band { font-size: 10px; border-radius: 999px; padding: 1px 6px; background: #1e293b; color: #94a3b8; }
.band.exact { background: #14532d; color: #86efac; }
.band.strong { background: #1e3a8a; color: #93c5fd; }
.band.contextual { background: #713f12; color: #fde68a; }
.band.weak { background: #7f1d1d; color: #fecaca; }
.band.unknown { background: #3f3f46; color: #d4d4d8; }
.row { display: flex; gap: 6px; }
.key { color: #64748b; min-width: 74px; }
.val { color: #e2e8f0; word-break: break-word; }
.val.semantic { color: #7dd3fc; font-weight: 700; }
.val.confidence { color: #facc15; }
.meta { color: #64748b; font-size: 11px; margin-top: 2px; }
.empty { padding: 12px; color: #94a3b8; text-align: center; }
`;

function fieldLabel(entry: DebugFieldEntry): string {
  const { field } = entry;
  return field.label ?? field.ariaLabel ?? field.placeholder ?? field.name ?? '(no label)';
}

function renderList(container: HTMLElement, data: DebugPanelData): void {
  container.textContent = '';

  if (data.entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No interactive fields detected.';
    container.appendChild(empty);
    return;
  }

  data.entries.forEach((entry, index) => {
    const item = document.createElement('div');
    item.className = 'item';

    const head = document.createElement('div');
    head.className = 'item-head';
    const idx = document.createElement('span');
    idx.className = 'index';
    idx.textContent = `#${index + 1}`;
    const band = document.createElement('span');
    const bandName = classificationBand(entry.classification.confidence);
    band.className = `band ${bandName}`;
    band.textContent = bandDescription(entry.classification.confidence);
    head.append(idx, band);

    const rows: Array<[string, string, string]> = [
      ['Label', fieldLabel(entry), ''],
      ['Semantic', entry.classification.semanticField, 'semantic'],
      ['Confidence', entry.classification.confidence.toFixed(2), 'confidence'],
    ];
    item.appendChild(head);
    for (const [key, value, cls] of rows) {
      const row = document.createElement('div');
      row.className = 'row';
      const keyEl = document.createElement('span');
      keyEl.className = 'key';
      keyEl.textContent = `${key}:`;
      const val = document.createElement('span');
      val.className = `val ${cls}`.trim();
      val.textContent = value;
      row.append(keyEl, val);
      item.appendChild(row);
    }

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${entry.classification.method} · ${entry.classification.reason}`;
    item.appendChild(meta);

    container.appendChild(item);
  });
}

function summaryText(data: DebugPanelData): string {
  const unknown = data.entries.filter((e) => e.classification.semanticField === 'unknown').length;
  const page = data.pageType
    ? `${data.pageType}${data.pageConfidence != null ? ` (${data.pageConfidence.toFixed(2)})` : ''}`
    : 'not analyzed';
  return `${data.entries.length} fields · ${unknown} unknown · page: ${page}`;
}

export function createDebugPanel(
  data: DebugPanelData,
  callbacks: DebugPanelCallbacks = {}
): DebugPanel {
  const host = document.createElement('div');
  host.id = 'ua-debug-panel';
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = STYLES;
  shadow.appendChild(style);

  const panel = document.createElement('div');
  panel.className = 'panel';
  shadow.appendChild(panel);

  const header = document.createElement('div');
  header.className = 'header';
  const titleGroup = document.createElement('div');
  const title = document.createElement('h2');
  title.textContent = 'Detected Fields';
  const summary = document.createElement('div');
  summary.className = 'summary';
  titleGroup.append(title, summary);
  const close = document.createElement('button');
  close.className = 'close';
  close.setAttribute('aria-label', 'Close debug panel');
  close.textContent = '×';
  header.append(titleGroup, close);
  panel.appendChild(header);

  const list = document.createElement('div');
  list.className = 'list';
  panel.appendChild(list);

  close.addEventListener('click', () => {
    callbacks.onClose?.();
    host.remove();
  });

  function apply(next: DebugPanelData): void {
    summary.textContent = summaryText(next);
    renderList(list, next);
  }

  apply(data);

  return {
    element: host,
    update: apply,
    destroy(): void {
      host.remove();
    },
  };
}
