import { cx, fieldLabel, fieldLabelStacked, focusRing } from '@/design-systems/industrial/classes';

/**
 * Visible label and native <select>. `options` is a list of { value, label },
 * or of groups { group, options } rendered as <optgroup>.
 * onChange receives the string value. `className` goes on the row, other props
 * on the <select>. `layout`: inline (label beside, default) or stacked (label above).
 * `labelHidden` keeps the label for assistive technology only.
 */
export default function Select({
  id,
  label,
  value,
  onChange,
  options,
  layout = 'inline',
  labelHidden = false,
  labelClassName,
  className,
  ref,
  ...rest
}) {
  const stacked = layout === 'stacked';
  return (
    <div className={cx('flex min-w-0', stacked ? 'flex-col gap-1' : 'items-center gap-2', className)}>
      <label htmlFor={id} className={labelHidden ? 'sr-only' : cx(stacked ? fieldLabelStacked : fieldLabel, labelClassName)}>
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
        {options.map((opt) =>
          opt.group ? (
            <optgroup key={`group-${opt.group}`} label={opt.group}>
              {opt.options.map((o) => (
                <option key={String(o.value)} value={o.value} disabled={o.disabled}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ) : (
            <option key={String(opt.value)} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ),
        )}
      </select>
    </div>
  );
}
