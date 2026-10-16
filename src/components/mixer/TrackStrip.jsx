'use client';

import Meter from '@/components/ui/Meter';
import Slider from '@/components/ui/Slider';
import Toggle from '@/components/ui/Toggle';
import { sectionHeading } from '@/design-systems/industrial/classes';
import { TRACK_GAIN } from '@/dsp/mixer/mixer';
import PanSlider from './PanSlider';

/** Fader text: "−6.0 dB"; the minimum reads "−∞ dB". */
export function faderText(db) {
  if (db <= TRACK_GAIN.min) return '−∞ dB';
  return `${db.toFixed(1)} dB`.replace('-', '−');
}

/**
 * Channel strip for one track (MIX-01, ARR-01): Mute and Solo toggles named
 * for the track, volume fader (−∞ to +6 dB), pan and a peak meter.
 * `readMeter()` returns [peakL, peakR] or null.
 */
export default function TrackStrip({ track, readMeter, onChange, disabled }) {
  const name = track.name;
  return (
    <li className="flex min-w-48 flex-col gap-2 rounded-ds border border-border-strong bg-surface p-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className={sectionHeading}>{name}</h3>
        <span className="text-xs text-muted">{track.mute ? 'Muted' : track.solo ? 'Solo' : ''}</span>
      </div>
      <div className="flex gap-2">
        <Toggle size="sm" pressed={track.mute} onClick={() => onChange({ mute: !track.mute })} disabled={disabled}>
          Mute<span className="sr-only"> {name}</span>
        </Toggle>
        <Toggle size="sm" pressed={track.solo} onClick={() => onChange({ solo: !track.solo })} disabled={disabled}>
          Solo<span className="sr-only"> {name}</span>
        </Toggle>
      </div>
      <div className="flex items-end gap-2">
        <div className="flex flex-1 flex-col gap-1">
          <Slider
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
          />
          <PanSlider id={`pan-${track.id}`} name={name} value={track.pan} onChange={(pan) => onChange({ pan })} disabled={disabled} />
        </div>
        <Meter read={readMeter} />
      </div>
    </li>
  );
}
