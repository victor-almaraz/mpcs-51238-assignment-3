/*
 * Instrument registry: device type → { params, Kernel }. Shared by the main
 * thread (UI, compile step) and the worklet (kernel construction). Types not
 * listed here have no kernel yet and render silence.
 */
import { ADDITIVE_PARAMS, AdditiveKernel } from './additive.js';
import { DRUM_PARAMS, DrumKernel } from './drums.js';
import { FM_PARAMS, FmKernel } from './fm.js';
import { GRANULAR_PARAMS, GranularKernel } from './granular.js';
import { PLUCK_PARAMS, PluckKernel } from './pluck.js';
import { SAMPLER_PARAMS, SamplerKernel } from './sampler.js';
import { SUBTRACTIVE_PARAMS, SubtractiveKernel } from './subtractive.js';

export const INSTRUMENTS = Object.freeze({
  subtractive: Object.freeze({ params: SUBTRACTIVE_PARAMS, Kernel: SubtractiveKernel }),
  fm: Object.freeze({ params: FM_PARAMS, Kernel: FmKernel }),
  additive: Object.freeze({ params: ADDITIVE_PARAMS, Kernel: AdditiveKernel }),
  pluck: Object.freeze({ params: PLUCK_PARAMS, Kernel: PluckKernel }),
  granular: Object.freeze({ params: GRANULAR_PARAMS, Kernel: GranularKernel }),
  drums: Object.freeze({ params: DRUM_PARAMS, Kernel: DrumKernel }),
  sampler: Object.freeze({ params: SAMPLER_PARAMS, Kernel: SamplerKernel }),
});

/** The registry entry for instrument `type`, or undefined. */
export function instrumentFor(type) {
  return INSTRUMENTS[type];
}
