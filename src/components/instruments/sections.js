/*
 * Device panel sections (DEV-02): each parameter's heading in a panel, so
 * knobs group as Oscillator, Filter, Envelope, Tuning and so on. A def's own
 * `group` takes precedence; panels lay the sections out.
 */

/** Panel section of each parameter that does not name its own `group` (DEV-02). */
const SECTIONS = {
  waveform: 'Oscillator',
  ratio: 'Operator',
  fine: 'Operator',
  index: 'Operator',
  indexDecay: 'Operator',
  damping: 'String',
  brightness: 'String',
  pickPosition: 'String',
  source: 'Source',
  position: 'Grains',
  grainSize: 'Grains',
  density: 'Grains',
  spray: 'Grains',
  pitchSpread: 'Grains',
  vibratoRate: 'Vibrato',
  vibratoDepth: 'Vibrato',
  cutoff: 'Filter',
  resonance: 'Filter',
  envAmount: 'Filter',
  attack: 'Envelope',
  decay: 'Envelope',
  sustain: 'Envelope',
  release: 'Envelope',
  // Sampler
  fineTune: 'Tuning',
  loopMode: 'Loop',
  trigger: 'Playback',
  voiceMode: 'Playback',
  glide: 'Playback',
  velSens: 'Playback',
  filterEnvAmount: 'Filter',
  pan: 'Output',
  level: 'Output',
};

/** Consecutive defs of one section become one { section, defs } item, in definition order. */
export function sectionParams(defs) {
  const items = [];
  for (const def of defs) {
    const section = def.group ?? SECTIONS[def.id] ?? 'Settings';
    const last = items[items.length - 1];
    if (last?.section === section) last.defs.push(def);
    else items.push({ section, defs: [def] });
  }
  return items;
}
