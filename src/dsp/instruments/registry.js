/*
 * Instrument registry: device type → { params, Kernel }. Shared by the main
 * thread (UI, compile step) and the worklet (kernel construction). Types not
 * listed here have no kernel yet and render silence.
 */
import { ADDITIVE_PARAMS, AdditiveKernel } from './additive.js';
import { FM_PARAMS, FmKernel } from './fm.js';
import { PLUCK_PARAMS, PluckKernel } from './pluck.js';
import { SUBTRACTIVE_PARAMS, SubtractiveKernel } from './subtractive.js';

export const INSTRUMENTS = Object.freeze({
  subtractive: Object.freeze({ params: SUBTRACTIVE_PARAMS, Kernel: SubtractiveKernel }),
  fm: Object.freeze({ params: FM_PARAMS, Kernel: FmKernel }),
  additive: Object.freeze({ params: ADDITIVE_PARAMS, Kernel: AdditiveKernel }),
  pluck: Object.freeze({ params: PLUCK_PARAMS, Kernel: PluckKernel }),
});

/** The registry entry for instrument `type`, or undefined. */
export function instrumentFor(type) {
  return INSTRUMENTS[type];
}
