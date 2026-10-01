// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshRegistry, getRegistry } from '../../extension/src/content/fieldRegistry';
import {
  createDebugPanel,
  buildDebugData,
} from '../../extension/src/content/debugPanel';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');

function loadFixture(name: string): void {
  const html = readFileSync(path.join(FIXTURES_DIR, name), 'utf-8');
  document.open();
  document.write(html);
  document.close();
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
  document.getElementById('ua-debug-panel')?.remove();
});

function debugData(pageType: 'APPLICATION_FORM' = 'APPLICATION_FORM') {
  refreshRegistry();
  return buildDebugData(getRegistry().map((e) => e.field), {
    pageType,
    pageConfidence: 0.9,
  });
}

describe('createDebugPanel', () => {
  beforeEach(() => loadFixture('simple.html'));

  it('shows the spec layout: index, label, semantic and confidence', () => {
    const panel = createDebugPanel(debugData());
    document.documentElement.appendChild(panel.element);
    const shadow = panel.element.shadowRoot!;

    expect(shadow.querySelector('.header h2')?.textContent).toBe('Detected Fields');
    expect(shadow.querySelector('.summary')?.textContent).toContain('APPLICATION_FORM (0.90)');

    const items = Array.from(shadow.querySelectorAll('.item'));
    expect(items.length).toBeGreaterThanOrEqual(12);
    expect(items[0].querySelector('.index')?.textContent).toBe('#1');

    const emailItem = items.find(
      (item) => item.querySelector('.val.semantic')?.textContent === 'email'
    );
    expect(emailItem).toBeDefined();
    const rows = Array.from(emailItem!.querySelectorAll('.row')).map(
      (row) => `${row.querySelector('.key')?.textContent} ${row.querySelector('.val')?.textContent}`
    );
    expect(rows[0]).toBe('Label: Email Address');
    expect(rows[1]).toBe('Semantic: email');
    expect(rows[2]).toBe('Confidence: 0.99');

    panel.destroy();
    expect(document.getElementById('ua-debug-panel')).toBeNull();
  });

  it('renders every detected field with a two-decimal confidence', () => {
    const data = debugData();
    const panel = createDebugPanel(data);
    const shadow = panel.element.shadowRoot!;

    const confidences = Array.from(shadow.querySelectorAll('.val.confidence')).map(
      (el) => el.textContent ?? ''
    );
    expect(confidences).toHaveLength(data.entries.length);
    for (const value of confidences) {
      expect(value).toMatch(/^\d\.\d{2}$/);
    }

    const semantics = Array.from(shadow.querySelectorAll('.val.semantic')).map(
      (el) => el.textContent
    );
    expect(semantics).toContain('email');
    expect(semantics).toContain('github');
    expect(semantics).toContain('linkedin');

    panel.destroy();
  });

  it('labels confidence bands per the documented thresholds', () => {
    const panel = createDebugPanel(debugData());
    const bands = Array.from(panel.element.shadowRoot!.querySelectorAll('.band')).map(
      (el) => el.className
    );
    expect(bands.some((cls) => cls.includes('exact'))).toBe(true);
    expect(bands.some((cls) => cls.includes('unknown'))).toBe(false);

    panel.destroy();
  });

  it('updates in place when the DOM changes', () => {
    const panel = createDebugPanel(debugData());
    const before = panel.element.shadowRoot!.querySelectorAll('.item').length;

    document.body.insertAdjacentHTML(
      'beforeend',
      '<label for="dyn-extra">Notice period</label><input id="dyn-extra" name="notice_period" />'
    );
    panel.update(debugData());

    const after = panel.element.shadowRoot!.querySelectorAll('.item').length;
    expect(after).toBe(before + 1);

    const semantics = Array.from(
      panel.element.shadowRoot!.querySelectorAll('.val.semantic')
    ).map((el) => el.textContent);
    expect(semantics).toContain('notice_period');

    panel.destroy();
  });

  it('closes via the close button and notifies the caller', () => {
    const onClose = vi.fn();
    const panel = createDebugPanel(debugData(), { onClose });
    document.documentElement.appendChild(panel.element);

    (panel.element.shadowRoot!.querySelector('.close') as HTMLButtonElement).click();
    expect(onClose).toHaveBeenCalled();
    expect(document.getElementById('ua-debug-panel')).toBeNull();
  });

  it('shows an empty state when no fields are detected', () => {
    const panel = createDebugPanel({
      pageType: 'NOT_JOB_PAGE',
      pageConfidence: 0.85,
      entries: [],
    });
    expect(panel.element.shadowRoot!.querySelector('.empty')?.textContent).toContain(
      'No interactive fields detected'
    );
    panel.destroy();
  });
});

describe('buildDebugData', () => {
  it('classifies every field without invoking a website-specific selector', () => {
    loadFixture('unknown-ats.html');
    const data = debugData();
    expect(data.entries.length).toBeGreaterThanOrEqual(8);

    const github = data.entries.find((e) => e.classification.semanticField === 'github');
    expect(github).toBeDefined();
    expect(github!.field.name).toBe('field_3928');
    expect(github!.classification.confidence).toBeGreaterThanOrEqual(0.8);

    for (const entry of data.entries) {
      if (entry.classification.semanticField !== 'unknown') {
        expect(entry.classification.confidence).toBeGreaterThanOrEqual(0.6);
      }
    }
  });
});
