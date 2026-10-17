'use client';

import Knob from '@/components/ui/Knob';
import { PAN } from '@/dsp/mixer/mixer';

/** Short pan text: "L20", "C", "R20". */
export function panShort(p) {
  const v = Math.round(p * 100);
  return v === 0 ? 'C' : v < 0 ? `L${-v}` : `R${v}`;
}

/** Spoken pan text: "Left 20", "Centre", "Right 20". */
export function panSpoken(p) {
  const v = Math.round(p * 100);
  return v === 0 ? 'Centre' : v < 0 ? `Left ${-v}` : `Right ${v}`;
}

/** Parses typed pan text: "L20", "R5", "C", "-0.2" (a fraction). Null for other text. */
export function parsePan(text) {
  const t = text.trim().replace(/−/g, '-');
  if (/^c(entre|enter)?$/i.test(t)) return 0;
  const m = /^([lr])\s*(\d+)$/i.exec(t);
  if (m) return (m[1].toLowerCase() === 'l' ? -1 : 1) * (Number(m[2]) / 100);
  const n = Number(t);
  return Number.isFinite(n) && t !== '' ? n : null;
}

/** Pan knob (MIX-01): −1 to +1, readout "L20", spoken "Left 20"; Delete or double-click centres. */
export default function PanKnob({ id, name, value, onChange, disabled }) {
  return (
    <Knob
      id={id}
      label={`${name} pan`}
      caption="Pan"
      min={PAN.min}
      max={PAN.max}
      step={PAN.step}
      value={value}
      valueText={panSpoken(value)}
      display={panShort(value)}
      parse={parsePan}
      onChange={onChange}
      onReset={() => onChange(0)}
      disabled={disabled}
    />
  );
}
