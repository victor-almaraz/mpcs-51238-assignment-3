/*
 * Web MIDI input (midi.md, Web MIDI input; assignment-3-scope.md, MIDI).
 * Access is requested only from a user action, with sysex off. Status bytes
 * ≥ 0xF0 are ignored. Note-on, note-off, sustain (CC 64 ≥ 64 is down: note-offs
 * wait until release), all sound off (CC 120) and all notes off (CC 123) are
 * handled; pitch bend and other messages are ignored.
 */
import { CC_ALL_NOTES_OFF, CC_ALL_SOUND_OFF, CC_SUSTAIN, CONTROL_CHANGE, NOTE_OFF, NOTE_ON } from '../../dsp/engine/live-input.js';

export const MIDI_UNSUPPORTED = 'Web MIDI is not supported in this browser.';
export const MIDI_FIREFOX = 'Firefox asks to install a site permission add-on. Connect the MIDI device before starting Firefox.';
export const MIDI_DENIED = 'MIDI access was not allowed. Allow it in the browser’s site settings to play from a MIDI device.';
export const MIDI_NO_DEVICES = 'No MIDI devices found. Connect a device; it is picked up when it appears.';

/** True when the browser exposes Web MIDI. */
export function midiSupported() {
  return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
}

/** True in Firefox, which gates Web MIDI behind a site-permission add-on. */
export function isFirefox() {
  return typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent);
}

/**
 * Interprets one MIDI message. Returns { type: 'on' | 'off' | 'sustain' |
 * 'allSoundOff' | 'allNotesOff', pitch?, velocity?, down? } or null when ignored.
 */
export function parseMidi(data) {
  if (!data || data.length < 1) return null;
  const status = data[0];
  if (status >= 0xf0) return null;
  const kind = status & 0xf0;
  const d1 = data[1] & 0x7f;
  const d2 = data[2] & 0x7f;
  if (kind === NOTE_ON && d2 > 0) return { type: 'on', pitch: d1, velocity: d2 };
  if (kind === NOTE_OFF || kind === NOTE_ON) return { type: 'off', pitch: d1 };
  if (kind === CONTROL_CHANGE) {
    if (d1 === CC_SUSTAIN) return { type: 'sustain', down: d2 >= 64 };
    if (d1 === CC_ALL_SOUND_OFF) return { type: 'allSoundOff' };
    if (d1 === CC_ALL_NOTES_OFF) return { type: 'allNotesOff' };
  }
  return null;
}

/**
 * Connects every MIDI input. Calls onNoteOn(pitch, velocity, isHeld),
 * onNoteOff(pitch), onAllOff(hard) and onStatus(text). Returns a promise of a
 * disconnect function. Call from a click handler.
 */
export async function connectMidi({ onNoteOn, onNoteOff, onAllOff, onStatus }) {
  if (!midiSupported()) {
    onStatus(MIDI_UNSUPPORTED);
    return () => {};
  }
  let access;
  try {
    access = await navigator.requestMIDIAccess({ sysex: false });
  } catch (err) {
    if (err?.name === 'SecurityError' || err?.name === 'NotAllowedError') {
      onStatus(isFirefox() ? `${MIDI_DENIED} ${MIDI_FIREFOX}` : MIDI_DENIED);
      return () => {};
    }
    throw err;
  }
  const held = new Set();
  const sustained = new Set();
  let sustain = false;

  function handle(event) {
    const msg = parseMidi(event.data);
    if (!msg) return;
    if (msg.type === 'on') {
      held.add(msg.pitch);
      sustained.delete(msg.pitch);
      onNoteOn(msg.pitch, msg.velocity, () => held.has(msg.pitch) || sustained.has(msg.pitch));
    } else if (msg.type === 'off') {
      held.delete(msg.pitch);
      if (sustain) sustained.add(msg.pitch);
      else onNoteOff(msg.pitch);
    } else if (msg.type === 'sustain') {
      sustain = msg.down;
      if (!sustain) {
        for (const p of sustained) onNoteOff(p);
        sustained.clear();
      }
    } else {
      held.clear();
      sustained.clear();
      onAllOff(msg.type === 'allSoundOff');
    }
  }

  function bind() {
    const names = [];
    for (const input of access.inputs.values()) {
      input.onmidimessage = handle;
      names.push(input.name || 'MIDI input');
    }
    onStatus(names.length ? `MIDI input: ${names.join(', ')}` : MIDI_NO_DEVICES);
  }

  bind();
  access.onstatechange = bind;
  return () => {
    access.onstatechange = null;
    for (const input of access.inputs.values()) input.onmidimessage = null;
    onAllOff(false);
  };
}
