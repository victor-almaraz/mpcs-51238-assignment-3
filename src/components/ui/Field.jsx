import { cx, focusRing } from '@/design-systems/industrial/classes';

/**
 * Stacked text or number field: visible label, input, optional description and
 * error. The error renders below the input, is linked with aria-describedby and
 * sets aria-invalid="true". Other props go on the <input>.
 */
export default function Field({
  id,
  label,
  description,
  error,
  className,
  'aria-describedby': describedBy,
  ref,
  ...rest
}) {
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedByIds = [descriptionId, errorId, describedBy].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cx('flex min-w-0 flex-col gap-1', className)}>
      <label htmlFor={id} className="text-[0.6875rem] font-bold uppercase tracking-[0.04em] text-muted">
        {label}
      </label>
      {description ? (
        <p id={descriptionId} className="text-xs text-muted">
          {description}
        </p>
      ) : null}
      <input
        ref={ref}
        id={id}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedByIds}
        className={cx(
          'min-h-8 w-full min-w-0 rounded-ds border bg-surface px-2 text-sm text-fg',
          error ? 'border-danger' : 'border-border-strong enabled:hover:border-fg',
          'disabled:cursor-not-allowed disabled:opacity-40',
          focusRing,
        )}
        {...rest}
      />
      {error ? (
        <p id={errorId} className="flex items-start gap-1 text-sm text-danger">
          <span aria-hidden="true">▲</span>
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
