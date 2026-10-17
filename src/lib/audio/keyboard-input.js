/*
 * Computer-keyboard notes (midi.md, Computer keyboard input). KeyboardEvent.code
 * maps to semitones above the base C: A W S E D F T G Y H U J K = 0–12.
 * KeyZ and KeyX move the base octave down and up; the base C of octave o is
 * MIDI 12·(o + 1), so octave 4 is C4 = 60 and octaves 0–7 cover C0–C8.
 * Input is inactive in text entry, while a dialog is open and while disabled.
 * Key repeat is ignored; modified keys (Ctrl, Meta, Alt) are left to the page.
 * Pressing or releasing Meta ends held notes: macOS browsers send no keyup for
 * other keys while Meta is down, so those notes would otherwise stick.
 */

export const KEY_SEMITONES = Object.freeze({
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6,
  KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12,
});

export const OCTAVE_MIN = 0;
export const OCTAVE_MAX = 7;
export const KEYBOARD_VELOCITY = 100;

const TEXT_ENTRY = 'input:not([type="range"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]), textarea, select, [contenteditable], [contenteditable="true"]';

/** True for the keys keyboard input uses: the note keys and the octave keys Z and X. */
export const isNoteKey = (code) => KEY_SEMITONES[code] !== undefined || code === 'KeyZ' || code === 'KeyX';

/** MIDI note for key `code` at base octave `octave`, or null when the key plays no note. */
export function pitchForCode(code, octave) {
  const semitone = KEY_SEMITONES[code];
  return semitone === undefined ? null : 12 * (octave + 1) + semitone;
}

/** Note name of MIDI `pitch`: "C4", "F#3". */
export function noteName(pitch) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return `${names[pitch % 12]}${Math.floor(pitch / 12) - 1}`;
}

/** True when keyboard notes should be ignored for event `e`: modifiers, text entry, open dialogs, or a key a focused editor already handled. */
export function ignoresKeyboard(e) {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return true;
  if (e.target?.closest?.(TEXT_ENTRY)) return true;
  return typeof document !== 'undefined' && document.querySelector('dialog[open]') !== null;
}

/**
 * Creates keyboard input calling onNoteOn(pitch, velocity, isHeld),
 * onNoteOff(pitch) and onOctave(octave). attach() listens on window; held
 * notes end on blur and when disabled, so no note sticks.
 */
export function createKeyboardInput({ onNoteOn, onNoteOff, onOctave, octave: initialOctave = 4 }) {
  let octave = Math.min(OCTAVE_MAX, Math.max(OCTAVE_MIN, initialOctave));
  let enabled = true;
  const held = new Map(); // code → pitch

  function releaseAll() {
    for (const pitch of held.values()) onNoteOff(pitch);
    held.clear();
  }

  function onKeyDown(e) {
    if (e.metaKey || e.key === 'Meta') releaseAll();
    if (!enabled || e.repeat || ignoresKeyboard(e)) return;
    if (e.code === 'KeyZ' || e.code === 'KeyX') {
      const next = Math.min(OCTAVE_MAX, Math.max(OCTAVE_MIN, octave + (e.code === 'KeyX' ? 1 : -1)));
      if (next !== octave) {
        releaseAll();
        octave = next;
        onOctave(octave);
      }
      e.preventDefault();
      return;
    }
    const pitch = pitchForCode(e.code, octave);
    if (pitch === null || held.has(e.code)) return;
    e.preventDefault();
    held.set(e.code, pitch);
    onNoteOn(pitch, KEYBOARD_VELOCITY, () => held.get(e.code) === pitch);
  }

  function onKeyUp(e) {
    if (e.key === 'Meta') {
      releaseAll();
      return;
    }
    const pitch = held.get(e.code);
    if (pitch === undefined) return;
    held.delete(e.code);
    onNoteOff(pitch);
  }

  return {
    attach() {
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', releaseAll);
    },
    detach() {
      releaseAll();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', releaseAll);
    },
    setEnabled(on) {
      enabled = on;
      if (!on) releaseAll();
    },
    octave: () => octave,
    setOctave(o) {
      releaseAll();
      octave = Math.min(OCTAVE_MAX, Math.max(OCTAVE_MIN, o));
    },
  };
}
