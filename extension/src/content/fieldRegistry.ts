import type { SemanticField } from '@schemas/dom';
import { scanFields } from './semanticExtractor';
import { collectRoots } from './rootCollector';

export interface RegistryEntry {
  field: SemanticField;
  element: Element;
}

let entries: RegistryEntry[] = [];
let lastScanAt = 0;

/**
 * Fingerprint -> element cache. Unchanged fields reuse their resolved element
 * instead of re-running selectors on every rescan; stale or disconnected
 * elements are re-resolved once and pruned when the field disappears.
 */
const elementCache = new Map<string, Element>();

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

function elementFor(field: SemanticField): Element | undefined {
  const cached = elementCache.get(field.fingerprint);
  if (cached?.isConnected) return cached;

  const resolved = resolveElement(field);
  if (resolved) elementCache.set(field.fingerprint, resolved);
  else elementCache.delete(field.fingerprint);
  return resolved;
}

function pruneCache(liveFingerprints: Set<string>): void {
  for (const fingerprint of Array.from(elementCache.keys())) {
    if (!liveFingerprints.has(fingerprint)) elementCache.delete(fingerprint);
  }
}

export function refreshRegistry(): SemanticField[] {
  const fields = scanFields();
  const next: RegistryEntry[] = [];

  for (const field of fields) {
    const element = elementFor(field);
    if (element) next.push({ field, element });
  }

  entries = next;
  pruneCache(new Set(fields.map((f) => f.fingerprint)));
  lastScanAt = Date.now();
  return fields;
}

export function registerFields(fields: SemanticField[]): void {
  const byFingerprint = new Map(entries.map((e) => [e.field.fingerprint, e]));
  for (const field of fields) {
    const element = elementFor(field);
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
