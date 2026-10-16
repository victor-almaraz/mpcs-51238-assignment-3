'use client';

import { useEffect, useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import StatusRegion from '@/components/ui/StatusRegion';
import Toggle from '@/components/ui/Toggle';
import { sectionHeading } from '@/design-systems/industrial/classes';
import { getEngine } from '@/lib/audio/engine-client';
import { createKeyboardInput, noteName } from '@/lib/audio/keyboard-input';
import { MIDI_FIREFOX, connectMidi, isFirefox, midiSupported, MIDI_UNSUPPORTED } from '@/lib/audio/midi-input';
import { getSettings, updateSettings } from '@/lib/settings/store';

/**
 * Live input (midi.md): computer-keyboard playing with an on/off toggle and the
 * octave, and Web MIDI connected from a button. Notes play on the engine's
 * live target track and pass through the volume notice. `onNote(pitch)` also
 * receives each note-on (step input in the piano roll).
 */
export default function LiveInputControls({ onNote }) {
  const engine = getEngine();
  const [enabled, setEnabled] = useState(true);
  const [octave, setOctave] = useState(() => Math.min(7, getSettings().keyboardOctave));
  const [midiStatus, setMidiStatus] = useState(null);
  const keyboard = useRef(null);
  const onNoteRef = useRef(onNote);
  const disconnectMidi = useRef(null);

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
      disconnectMidi.current?.();
    };
  }, [engine]);

  function toggleKeyboard() {
    keyboard.current?.setEnabled(!enabled);
    setEnabled(!enabled);
  }

  async function connect() {
    disconnectMidi.current?.();
    try {
      disconnectMidi.current = await connectMidi({
        onNoteOn: (pitch, velocity, isHeld) => {
          engine.noteOn(pitch, velocity, isHeld);
          onNoteRef.current?.(pitch);
        },
        onNoteOff: (pitch) => engine.noteOff(pitch),
        onAllOff: (hard) => engine.allLiveOff(hard),
        onStatus: setMidiStatus,
      });
    } catch (err) {
      console.error(err);
      setMidiStatus('MIDI devices could not be opened.');
    }
  }

  return (
    <section aria-labelledby="live-input-heading" className="flex flex-col gap-2">
      <h2 id="live-input-heading" className={sectionHeading}>
        Live input
      </h2>
      <div className="flex flex-wrap items-center gap-3">
        <Toggle pressed={enabled} onClick={toggleKeyboard}>
          Play with keyboard
        </Toggle>
        <StatusRegion className="text-sm">Keyboard octave: {noteName(12 * (octave + 1))}</StatusRegion>
        <Button onClick={connect}>Connect MIDI device</Button>
      </div>
      {midiStatus ? (
        <StatusRegion className="text-sm">{midiStatus}</StatusRegion>
      ) : !midiSupported() ? (
        <p className="text-sm text-muted">{MIDI_UNSUPPORTED}</p>
      ) : isFirefox() ? (
        <p className="text-sm text-muted">{MIDI_FIREFOX}</p>
      ) : null}
    </section>
  );
}
