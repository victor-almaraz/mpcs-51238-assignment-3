import { cx, fieldLabel, focusRing } from '@/design-systems/industrial/classes';

/**
 * Visible label and native <select>. `options` is a list of { value, label }.
 * onChange receives the string value. `className` goes on the row, other props
 * on the <select>.
 */
export default function Select({ id, label, value, onChange, options, labelClassName, className, ref, ...rest }) {
  return (
    <div className={cx('flex min-w-0 items-center gap-2', className)}>
      <label htmlFor={id} className={cx(fieldLabel, labelClassName)}>
        {label}
      </label>
      <select
        ref={ref}
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cx(
          'min-h-8 w-full min-w-0 flex-1 truncate rounded-ds border border-border-strong bg-surface px-2 text-sm text-fg',
          'cursor-pointer enabled:hover:border-fg enabled:hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40',
          focusRing,
        )}
        {...rest}
      >
        {options.map((opt) => (
          <option key={String(opt.value)} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
