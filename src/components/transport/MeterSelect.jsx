import Select from '@/components/ui/Select';
import { TIME_SIGNATURES } from '@/lib/project/model';

const OPTIONS = TIME_SIGNATURES.map((s) => ({ value: s.value, label: s.value }));

/** Time signature in the transport (NEW-03): the New project form's choices. */
export default function MeterSelect({ value, onChange, disabled }) {
  return (
    <Select
      id="transport-time-signature"
      label="Time signature"
      labelClassName="w-auto"
      value={value}
      onChange={onChange}
      options={OPTIONS}
      disabled={disabled}
      className="w-auto"
    />
  );
}
