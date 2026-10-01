// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { scanFields } from '../../extension/src/content/semanticExtractor';
import { refreshRegistry, getRegistry } from '../../extension/src/content/fieldRegistry';
import type { SemanticField } from '@schemas/dom';

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
});

function byId(fields: SemanticField[]): Map<string, SemanticField> {
  return new Map(fields.map((f) => [f.id, f]));
}

describe('rescan stability', () => {
  it('keeps identical ids and fingerprints when the DOM is unchanged', () => {
    loadFixture('simple.html');

    const first = scanFields();
    const second = scanFields();

    expect(second.map((f) => f.id)).toEqual(first.map((f) => f.id));
    expect(second.map((f) => f.fingerprint)).toEqual(first.map((f) => f.fingerprint));
    expect(new Set(first.map((f) => f.id)).size).toBe(first.length);
    for (const field of first) {
      expect(field.id).toMatch(/^field-/);
    }
  });

  it('does not reprocess unchanged fields when a new field appears', () => {
    loadFixture('dynamic-form.html');

    const first = scanFields();
    const firstIds = new Set(first.map((f) => f.id));
    expect(first.length).toBeGreaterThanOrEqual(2);

    document
      .getElementById('experience-list')!
      .insertAdjacentHTML(
        'beforeend',
        '<label for="exp-title">Job title</label><input type="text" id="exp-title" name="exp_title" />'
      );

    const second = scanFields();
    expect(second.length).toBe(first.length + 1);

    const secondById = byId(second);
    for (const field of first) {
      const unchanged = secondById.get(field.id);
      expect(unchanged, `field ${field.id} survived rescan`).toBeDefined();
      expect(unchanged!.fingerprint).toBe(field.fingerprint);
      expect(unchanged!.label).toBe(field.label);
    }

    const added = second.filter((f) => !firstIds.has(f.id));
    expect(added).toHaveLength(1);
    expect(added[0].label).toBe('Job title');
  });

  it('keeps duplicate fingerprints unique via ordered id suffixes', () => {
    document.body.innerHTML = `
      <h2>Details</h2>
      <div><input type="text" name="dup" aria-label="Reference" /></div>
      <div><input type="text" name="dup" aria-label="Reference" /></div>
    `;

    const first = scanFields();
    expect(first).toHaveLength(2);
    expect(first[0].fingerprint).toBe(first[1].fingerprint);
    expect(first[0].id).not.toBe(first[1].id);

    const second = scanFields();
    expect(second.map((f) => f.id)).toEqual(first.map((f) => f.id));
  });

  it('reuses resolved elements across registry refreshes', () => {
    loadFixture('simple.html');

    refreshRegistry();
    const first = getRegistry().map((e) => ({ ...e }));
    refreshRegistry();
    const second = getRegistry();

    expect(second).toHaveLength(first.length);
    expect(new Set(second.map((e) => e.field.fingerprint)).size).toBe(second.length);

    const secondByFingerprint = new Map(second.map((e) => [e.field.fingerprint, e]));
    for (const entry of first) {
      const match = secondByFingerprint.get(entry.field.fingerprint);
      expect(match).toBeDefined();
      expect(match!.element).toBe(entry.element);
    }
  });

  it('drops removed fields from the registry', () => {
    loadFixture('dynamic-form.html');
    refreshRegistry();
    const before = getRegistry().length;

    document.getElementById('dyn-email')!.remove();
    refreshRegistry();

    expect(getRegistry().length).toBe(before - 1);
    expect(getRegistry().some((e) => e.field.name === 'email')).toBe(false);
  });
});
