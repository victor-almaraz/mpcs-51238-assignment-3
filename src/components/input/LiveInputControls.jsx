'use client';

import { useEffect, useRef, useState } from 'react';
import StatusRegion from '@/components/ui/StatusRegion';
import { getEngine } from '@/lib/audio/engine-client';
import { createKeyboardInput, isNoteKey, noteName } from '@/lib/audio/keyboard-input';
import { claimKeys } from '@/lib/commands/registry';
import { MIDI_FIREFOX, connectMidi, isFirefox, midiSupported, MIDI_UNSUPPORTED } from '@/lib/audio/midi-input';
import { getSettings, updateSettings } from '@/lib/settings/store';
import IconButton from '@/components/ui/IconButton';
import IconToggle from '@/components/ui/IconToggle';

/**
 * Live input (midi.md): computer-keyboard playing with an on/off toggle and the
 * octave, and Web MIDI connected from a button. Notes play on the engine's
 * live target track and pass through the volume notice. `onNote(pitch)` also
 * receives each note-on (step input in the piano roll). While keyboard playing
 * is on, its letters play notes rather than run shortcuts (G, K).
 */
export default function LiveInputControls({ onNote, inputTo }) {
  const engine = getEngine();
  const [enabled, setEnabled] = useState(true);
  const [octave, setOctave] = useState(() => Math.min(7, getSettings().keyboardOctave));
  const [midiStatus, setMidiStatus] = useState(null);
  const keyboard = useRef(null);
  const onNoteRef = useRef(onNote);
  const disconnectMidi = useRef(null);
  const connectRun = useRef(0); // the current connect attempt; unmounting or a newer attempt ends it

  useEffect(() => {
    onNoteRef.current = onNote;
  }, [onNote]);

  useEffect(() => {
    const input = createKeyboardInput({
      octave: Math.min(7, getSettings().keyboardOctave),
      onNoteOn: (pitch, velocity, isHeld) => {
        engine.noteOn(pitch, velocity, isHeld);
        onNoteRef.current?.(pitch);
      },
      onNoteOff: (pitch) => engine.noteOff(pitch),
      onOctave: (o) => {
        setOctave(o);
        updateSettings({ keyboardOctave: o });
      },
    });
    input.attach();
    keyboard.current = input;
    return () => {
      input.detach();
      connectRun.current += 1;
      disconnectMidi.current?.();
      disconnectMidi.current = null;
    };
  }, [engine]);

  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);
  useEffect(() => claimKeys((e) => enabledRef.current && isNoteKey(e.code)), []);

  function toggleKeyboard() {
    keyboard.current?.setEnabled(!enabled);
    setEnabled(!enabled);
  }

  async function connect() {
    const run = ++connectRun.current;
    disconnectMidi.current?.();
    disconnectMidi.current = null;
    try {
      const disconnect = await connectMidi({
        onNoteOn: (pitch, velocity, isHeld) => {
          engine.noteOn(pitch, velocity, isHeld);
          onNoteRef.current?.(pitch);
        },
        onNoteOff: (pitch) => engine.noteOff(pitch),
        onAllOff: (hard) => engine.allLiveOff(hard),
        onStatus: setMidiStatus,
      });
      // Handlers bound after the controls unmounted, or after a newer attempt, are released at once.
      if (run !== connectRun.current) disconnect?.();
      else disconnectMidi.current = disconnect;
    } catch (err) {
      console.error(err);
      if (run === connectRun.current) setMidiStatus('MIDI devices could not be opened.');
    }
  }

  const midiNote = midiStatus || (!midiSupported() ? MIDI_UNSUPPORTED : isFirefox() ? MIDI_FIREFOX : '');
  return (
    <section aria-labelledby="live-input-heading" className="flex min-w-0 items-center gap-2">
      <h2 id="live-input-heading" className="sr-only">
        Live input
      </h2>
      <IconToggle icon="keyboard" label="Play with keyboard" size="sm" pressed={enabled} onClick={toggleKeyboard} data-help="Keys A to K play notes C to C on the selected track; Z and X change the octave." />
      {/* Where live notes go: the armed tracks, else the selected one. */}
      {inputTo ? (
        <span className="max-w-64 truncate text-xs" title={`Live input: ${inputTo}`} data-help="Live input plays on the armed tracks (the arm button on a track header, or R), else on the selected instrument track.">
          Input: {inputTo}
        </span>
      ) : null}
      <StatusRegion className="shrink-0 text-xs whitespace-nowrap">Keyboard octave: {noteName(12 * (octave + 1))}</StatusRegion>
      <IconButton icon="cable" label="Connect MIDI device" size="sm" onClick={connect} data-help="Asks the browser for MIDI devices; notes play on the selected track." />
      {midiStatus ? (
        <StatusRegion className="truncate text-xs">{midiNote}</StatusRegion>
      ) : midiNote ? (
        <p className="truncate text-xs text-muted" title={midiNote}>
          {midiNote}
        </p>
      ) : null}
    </section>
  );
}
