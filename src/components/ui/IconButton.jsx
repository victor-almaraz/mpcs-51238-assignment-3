import { buttonVariants, controlBase, cx, iconSizes } from '@/design-systems/industrial/classes';

/**
 * Ghost button whose only content is a decorative glyph. `label` is required and
 * becomes the accessible name; a missing label throws outside production builds.
 */
export default function IconButton({ label, size = 'md', children, className, ref, ...rest }) {
  if (process.env.NODE_ENV !== 'production' && !label) {
    throw new Error('IconButton requires a non-empty label prop.');
  }
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      className={cx(controlBase, iconSizes[size] ?? iconSizes.md, 'p-0', buttonVariants.ghost, className)}
      {...rest}
    >
      <span aria-hidden="true">{children}</span>
    </button>
  );
}
