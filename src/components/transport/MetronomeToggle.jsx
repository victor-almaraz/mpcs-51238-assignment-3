import IconToggle from '@/components/ui/IconToggle';

/** Metronome on/off. The name stays "Metronome"; aria-pressed carries the state. */
export default function MetronomeToggle({ on, onChange }) {
  return <IconToggle lamp icon="metronome" label="Metronome" shortcut="C" pressed={on} onClick={() => onChange(!on)} data-help="Metronome (C): clicks on every beat while playing." />;
}
