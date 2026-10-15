import { buttonVariants, controlBase, controlSizes, cx } from '@/design-systems/industrial/classes';

/**
 * Text button. `variant`: primary, secondary (default), ghost or danger.
 * `size`: sm (24 px), md (32 px, default) or lg (44 px) minimum target.
 */
export default function Button({ variant = 'secondary', size = 'md', type = 'button', className, ref, ...rest }) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        controlBase,
        controlSizes[size] ?? controlSizes.md,
        buttonVariants[variant] ?? buttonVariants.secondary,
        className,
      )}
      {...rest}
    />
  );
}
