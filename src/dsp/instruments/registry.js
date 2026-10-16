/*
 * Instrument registry: device type → { params, Kernel }. Shared by the main
 * thread (UI, compile step) and the worklet (kernel construction). Types not
 * listed here have no kernel yet and render silence.
 */
import { FM_PARAMS, FmKernel } from './fm.js';
import { SUBTRACTIVE_PARAMS, SubtractiveKernel } from './subtractive.js';

export const INSTRUMENTS = Object.freeze({
  subtractive: Object.freeze({ params: SUBTRACTIVE_PARAMS, Kernel: SubtractiveKernel }),
  fm: Object.freeze({ params: FM_PARAMS, Kernel: FmKernel }),
});

/** The registry entry for instrument `type`, or undefined. */
export function instrumentFor(type) {
  return INSTRUMENTS[type];
}
