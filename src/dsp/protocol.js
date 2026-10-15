/*
 * Message protocol shared by the main thread and the worklet
 * (a3-audio-implementation.md, Messaging protocol). Every message carries
 * `t` (type) and `v: 1`. Each validator returns null for a valid message or an
 * error code string.
 */

export const PROTOCOL_VERSION = 1;

/** Messages the safety processor accepts. */
export const SAFETY_IN = Object.freeze(['resume-fade', 'ack-duck']);

/** Messages the safety processor posts: guard { muted }, duck { active }, error { code, detail }. */
export const SAFETY_OUT = Object.freeze(['guard', 'duck', 'error']);

/** Validates the envelope shared by every message. */
export function validateEnvelope(msg) {
  if (msg === null || typeof msg !== 'object') return 'not-an-object';
  if (msg.v !== PROTOCOL_VERSION) return 'bad-version';
  if (typeof msg.t !== 'string') return 'missing-type';
  return null;
}

/** Validates a message sent to the safety processor. */
export function validateSafetyMessage(msg) {
  const envelope = validateEnvelope(msg);
  if (envelope) return envelope;
  return SAFETY_IN.includes(msg.t) ? null : 'unknown-type';
}
