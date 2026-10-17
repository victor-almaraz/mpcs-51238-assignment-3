'use client';

import Knob from '@/components/ui/Knob';
import { PAN } from '@/dsp/mixer/mixer';
import { panShort, panSpoken, parsePan } from './pan-text';

export { panShort, panSpoken, parsePan };

/** Pan knob (MIX-01): −1 to +1, readout "L20", spoken "Left 20", typed "20" or "L20"; Delete or double-click centres. */
export default function PanKnob({ id, name, value, onChange, disabled }) {
  return (
    <Knob
      id={id}
      label={`${name} pan`}
      caption="Pan"
      captionLines={1}
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
