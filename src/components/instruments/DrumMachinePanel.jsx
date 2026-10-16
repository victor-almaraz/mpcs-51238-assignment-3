'use client';

import { useState } from 'react';
import Select from '@/components/ui/Select';
import { sectionHeading } from '@/design-systems/industrial/classes';
import { clampParam } from '@/dsp/core/params';
import { DRUM_VOICES, DRUM_VOICE_NAMES } from '@/dsp/instruments/drum-map';
import { DRUM_PARAMS } from '@/dsp/instruments/drums';
import ParamControl from './ParamControl';

const DEF = Object.fromEntries(DRUM_PARAMS.map((d) => [d.id, d]));

/** What each voice's tone control does (a3-audio-implementation.md, Voice models). */
const TONE_LABELS = {
  kick: 'Click level',
  snare: 'Body/noise mix',
  sidestick: 'Highpass',
  clap: 'Bandpass centre',
  closedHat: 'Highpass',
  pedalHat: 'Highpass',
  openHat: 'Highpass',
  lowTom: 'Noise level',
  midTom: 'Noise level',
  highTom: 'Noise level',
  crash: 'Band balance',
  ride: 'Band balance',
  cowbell: 'Bandpass centre',
  claves: 'Pitch drop',
};

const FIELD_LABELS = { level: 'Level', tune: 'Tune', decay: 'Decay', pan: 'Pan' };
const KIT_LABELS = { 'kit.level': 'Kit level', 'kit.velSens': 'Velocity sensitivity', 'kit.choke': 'Choke' };
const VOICE_OPTIONS = DRUM_VOICES.map((id, i) => ({ value: id, label: DRUM_VOICE_NAMES[i] }));

/**
 * Drum machine controls: a voice selector with that voice's level, tune,
 * decay, tone and pan, and the kit's level, velocity sensitivity and choke.
 */
export default function DrumMachinePanel({ device, onParamChange, disabled }) {
  const [voice, setVoice] = useState(DRUM_VOICES[0]);
  const voiceName = DRUM_VOICE_NAMES[DRUM_VOICES.indexOf(voice)];
  const control = (id, label) => (
    <ParamControl
      key={id}
      def={DEF[id]}
      label={label}
      idPrefix={`instrument-${device.id}`}
      value={clampParam(DEF[id], device.params[id])}
      onChange={(paramId, value) => onParamChange(device.id, paramId, value)}
    />
  );

  return (
    <fieldset disabled={disabled} className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <Select id={`drum-voice-${device.id}`} label="Voice" value={voice} onChange={setVoice} options={VOICE_OPTIONS} />
        <fieldset className="flex flex-col gap-2 rounded-ds border border-border p-2">
          <legend className={sectionHeading}>{voiceName}</legend>
          {['level', 'tune', 'decay', 'tone', 'pan'].map((field) =>
            control(`${voice}.${field}`, field === 'tone' ? TONE_LABELS[voice] : FIELD_LABELS[field]),
          )}
        </fieldset>
      </div>
      <fieldset className="flex flex-col gap-2 rounded-ds border border-border p-2">
        <legend className={sectionHeading}>Kit</legend>
        {['kit.level', 'kit.velSens', 'kit.choke'].map((id) => control(id, KIT_LABELS[id]))}
      </fieldset>
    </fieldset>
  );
}
