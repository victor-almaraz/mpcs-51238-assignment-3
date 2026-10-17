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

/**
 * Defs grouped by section as { section, defs } items: sections in the order
 * they first appear, so a section split across the definitions (the
 * sampler's Playback) still renders once; within a section the enums
 * (segmented rows) come first, then the knobs, each in definition order.
 */
export function sectionParams(defs) {
  const items = new Map();
  for (const def of defs) {
    const section = def.group ?? SECTIONS[def.id] ?? 'Settings';
    if (!items.has(section)) items.set(section, { section, defs: [] });
    items.get(section).defs.push(def);
  }
  const isEnum = (def) => def.scale === 'enum';
  return [...items.values()].map((item) => ({ ...item, defs: [...item.defs.filter(isEnum), ...item.defs.filter((d) => !isEnum(d))] }));
}
