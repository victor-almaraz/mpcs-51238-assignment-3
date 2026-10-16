/** Display names of preset types: "Subtractive synth", "Reverb". */
import { EFFECTS } from '@/dsp/effects/registry';
import { INSTRUMENT_LABELS } from '@/lib/project/model';

export function typeLabel(kind, type) {
  return kind === 'effect' ? (EFFECTS[type]?.label ?? type) : (INSTRUMENT_LABELS[type] ?? type);
}
