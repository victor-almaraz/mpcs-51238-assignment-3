import { cx } from '@/design-systems/industrial/classes';

/** A panel module: a lighter face inside a thin border; its heading names it. */
export default function Card({ as: Tag = 'article', className, ref, ...rest }) {
  return (
    <Tag
      ref={ref}
      className={cx(
        'flex flex-col gap-4 rounded-ds border border-border-strong bg-surface p-3 text-fg md:p-4',
        className,
      )}
      {...rest}
    />
  );
}
