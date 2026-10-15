import { cx } from '@/design-systems/industrial/classes';

/** A panel module: a lighter face with a dark trim along the top edge. */
export default function Card({ as: Tag = 'article', className, ref, ...rest }) {
  return (
    <Tag
      ref={ref}
      className={cx(
        'flex flex-col gap-4 rounded-ds border border-border-strong border-t-4 border-t-fg bg-surface p-3 text-fg md:p-4',
        className,
      )}
      {...rest}
    />
  );
}
