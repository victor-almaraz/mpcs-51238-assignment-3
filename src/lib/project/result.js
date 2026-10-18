/** A failed command result: { ok: false, error: { code, message } }. Commands return { ok: true, doc, … } otherwise. */
export const fail = (code, message) => ({ ok: false, error: { code, message } });
