import IconToggle from '@/components/ui/IconToggle';

/** Metronome on/off. The name stays "Metronome"; aria-pressed carries the state. */
export default function MetronomeToggle({ on, onChange }) {
  return <IconToggle icon="metronome" label="Metronome" shortcut="K" pressed={on} onClick={() => onChange(!on)} data-help="Metronome (K): clicks on every beat while playing." />;
}
