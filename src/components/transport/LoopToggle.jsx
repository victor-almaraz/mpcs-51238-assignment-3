import IconToggle from '@/components/ui/IconToggle';

/** Loop on/off. The name stays "Loop"; aria-pressed carries the state. */
export default function LoopToggle({ on, onChange }) {
  return <IconToggle icon="repeat" label="Loop" shortcut="L" pressed={on} onClick={() => onChange(!on)} data-help="Loop (L): repeats the loop range while playing." />;
}
