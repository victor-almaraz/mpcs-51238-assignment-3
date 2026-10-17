import Toggle from '@/components/ui/Toggle';

/** Loop on/off. The name stays "Loop"; aria-pressed carries the state. */
export default function LoopToggle({ on, onChange }) {
  return (
    <Toggle pressed={on} onClick={() => onChange(!on)} data-help="Loop (L): repeats the loop range while playing.">
      Loop
    </Toggle>
  );
}
