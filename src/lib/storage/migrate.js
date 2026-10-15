/*
 * Project document migrations. MIGRATIONS[n] is a pure function from a schema
 * version n document to version n + 1. Version 1 is the first version, so the
 * registry is empty.
 */
import { SCHEMA_VERSION } from '../project/model.js';

export const MIGRATIONS = {};

/**
 * Brings `doc` to SCHEMA_VERSION by applying migrations in sequence.
 * Returns { ok: true, value, newer: false }, or { ok: true, value: doc, newer: true }
 * for a document from a newer build (opened read-only), or
 * { ok: false } when a step is missing. `migrations` defaults to MIGRATIONS.
 */
export function migrate(doc, migrations = MIGRATIONS, target = SCHEMA_VERSION) {
  if (doc.schemaVersion > target) return { ok: true, value: doc, newer: true };
  let current = doc;
  while (current.schemaVersion < target) {
    const step = migrations[current.schemaVersion];
    if (!step) return { ok: false };
    const next = step(current);
    if (next.schemaVersion !== current.schemaVersion + 1) {
      throw new Error(`Migration from v${current.schemaVersion} did not produce v${current.schemaVersion + 1}`);
    }
    current = next;
  }
  return { ok: true, value: current, newer: false };
}
