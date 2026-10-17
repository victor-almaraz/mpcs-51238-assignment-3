'use client';

import Fader from '@/components/ui/Fader';
import Meter from '@/components/ui/Meter';
import Toggle from '@/components/ui/Toggle';
import { TRACK_GAIN } from '@/dsp/mixer/mixer';
import ClipIndicator from './ClipIndicator';
import PanKnob from './PanKnob';

/** Fader text: "−6.0 dB"; the minimum reads "−∞ dB". */
export function faderText(db) {
  if (db <= TRACK_GAIN.min) return '−∞ dB';
  return `${db.toFixed(1)} dB`.replace('-', '−');
}

/**
 * Vertical channel strip for one track (MIX-01, MIX-02), top to bottom: pan
 * knob, clip indicator, fader with a dB scale beside the peak meter, the dB
 * readout, Mute and Solo (M and S, named "Mute Bass"), and the track name.
 * `readMeter()` returns [peakL, peakR] or null.
 */
export default function TrackStrip({ track, readMeter, onChange, disabled }) {
  const name = track.name;
  return (
    <li className="flex h-full w-24 shrink-0 flex-col items-center gap-1.5 rounded-ds border border-border-strong bg-surface px-1.5 py-2" style={{ borderTop: `3px solid ${track.color}` }}>
      <PanKnob id={`pan-${track.id}`} name={name} value={track.pan} onChange={(pan) => onChange({ pan })} disabled={disabled} />
      <ClipIndicator name={name} read={readMeter} />
      <Fader
        id={`fader-${track.id}`}
        label={`${name} volume`}
        min={TRACK_GAIN.min}
        max={TRACK_GAIN.max}
        step={TRACK_GAIN.step}
        value={track.gainDb}
        valueText={faderText(track.gainDb)}
        onChange={(gainDb) => onChange({ gainDb })}
        onReset={() => onChange({ gainDb: 0 })}
        disabled={disabled}
      >
        <Meter read={readMeter} className="h-full w-3" />
      </Fader>
      <output aria-hidden="true" className="min-h-6 w-full rounded-ds bg-window text-center font-mono text-xs leading-6 text-lamp">
        {faderText(track.gainDb)}
      </output>
      <div className="flex gap-1">
        <Toggle size="sm" pressed={track.mute} onClick={() => onChange({ mute: !track.mute })} disabled={disabled} aria-label={`Mute ${name}`} data-tip={`Mute ${name} (M on the track)`}>
          M
        </Toggle>
        <Toggle size="sm" pressed={track.solo} onClick={() => onChange({ solo: !track.solo })} disabled={disabled} aria-label={`Solo ${name}`} data-tip={`Solo ${name} (S on the track)`}>
          S
        </Toggle>
      </div>
      <h3 className="w-full truncate text-center text-xs font-bold uppercase" title={name}>
        {name}
      </h3>
    </li>
  );
}
