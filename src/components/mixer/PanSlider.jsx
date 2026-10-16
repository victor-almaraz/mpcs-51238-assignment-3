import Slider from '@/components/ui/Slider';
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

/** Pan slider (MIX-01): −1 to +1, readout "L20", spoken "Left 20"; Delete or double-click centres. */
export default function PanSlider({ id, name, value, onChange, disabled }) {
  return (
    <Slider
      id={id}
      label={`${name} pan`}
      min={PAN.min}
      max={PAN.max}
      step={PAN.step}
      value={value}
      valueText={panSpoken(value)}
      display={panShort(value)}
      onChange={onChange}
      onReset={() => onChange(0)}
      disabled={disabled}
    />
  );
}
