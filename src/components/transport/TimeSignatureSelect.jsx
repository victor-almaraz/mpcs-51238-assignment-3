import Select from '@/components/ui/Select';
import { cx, fieldLabel, fieldLabelStacked } from '@/design-systems/industrial/classes';
import { BEATS_PER_BAR_MAX, NOTE_VALUES, parseTimeSignature } from '@/lib/project/model';

const BEATS = Array.from({ length: BEATS_PER_BAR_MAX }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));
const NOTES = NOTE_VALUES.map((d) => ({ value: String(d), label: String(d) }));

/**
 * Time signature (NEW-03): beats per bar over a note value, as two native selects
 * in a group named "Time signature". `value` and onChange use "n/d" strings.
 * Used by the transport (inline) and the New project form (stacked).
 */
export default function TimeSignatureSelect({ id, value, onChange, disabled, layout = 'inline' }) {
  const { numerator, denominator } = parseTimeSignature(value) ?? { numerator: 4, denominator: 4 };
  const stacked = layout === 'stacked';
  return (
    <div role="group" aria-labelledby={`${id}-label`} className={cx('flex min-w-0', stacked ? 'flex-col gap-1' : 'items-center gap-2')}>
      <span id={`${id}-label`} className={stacked ? fieldLabelStacked : fieldLabel}>
        Time signature
      </span>
      <div className="flex items-center gap-1">
        <Select
          id={`${id}-beats`}
          label="Beats per bar"
          labelHidden
          className="w-auto"
          value={String(numerator)}
          options={BEATS}
          disabled={disabled}
          onChange={(n) => onChange(`${n}/${denominator}`)}
          data-help="Beats per bar: the time signature's upper number, 1 to 32."
        />
        <span aria-hidden="true" className="text-muted">
          /
        </span>
        <Select
          id={`${id}-note`}
          label="Note value"
          labelHidden
          className="w-auto"
          value={String(denominator)}
          options={NOTES}
          disabled={disabled}
          onChange={(d) => onChange(`${numerator}/${d}`)}
          data-help="Note value: the note that counts one beat; 4 is a quarter note, 8 an eighth."
        />
      </div>
    </div>
  );
}
