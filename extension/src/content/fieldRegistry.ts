import type { SemanticField } from '@schemas/dom';
import { scanFields } from './semanticExtractor';
import { collectRoots } from './rootCollector';

export interface RegistryEntry {
  field: SemanticField;
  element: Element;
}

let entries: RegistryEntry[] = [];
let lastScanAt = 0;

function resolveElement(field: SemanticField): Element | undefined {
  for (const root of collectRoots()) {
    try {
      const el = root.querySelector(field.selector);
      if (el) return el;
    } catch {
      /* invalid selector for this root */
    }
  }
  return undefined;
}

export function refreshRegistry(): SemanticField[] {
  const fields = scanFields();
  entries = fields
    .map((field) => ({ field, element: resolveElement(field) }))
    .filter((entry): entry is RegistryEntry => Boolean(entry.element));
  lastScanAt = Date.now();
  return fields;
}

export function registerFields(fields: SemanticField[]): void {
  const byFingerprint = new Map(entries.map((e) => [e.field.fingerprint, e]));
  for (const field of fields) {
    const element = resolveElement(field);
    if (!element) continue;
    byFingerprint.set(field.fingerprint, { field, element });
  }
  entries = Array.from(byFingerprint.values());
}

export function getFieldByFingerprint(fingerprint: string): RegistryEntry | undefined {
  return entries.find((e) => e.field.fingerprint === fingerprint);
}

export function getFieldById(id: string): RegistryEntry | undefined {
  return entries.find((e) => e.field.id === id);
}

export function getRegistry(): RegistryEntry[] {
  return entries;
}

export function getLastScanAt(): number {
  return lastScanAt;
}