import Toggle from '@/components/ui/Toggle';

/** Metronome on/off. The name stays "Metronome"; aria-pressed carries the state. */
export default function MetronomeToggle({ on, onChange }) {
  return (
    <Toggle pressed={on} onClick={() => onChange(!on)} data-help="Metronome (K): clicks on every beat while playing.">
      Metronome
    </Toggle>
  );
}
