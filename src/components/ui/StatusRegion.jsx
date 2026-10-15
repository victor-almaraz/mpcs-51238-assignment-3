import { cx } from '@/design-systems/industrial/classes';

/**
 * Polite live region (role="status"). Screen readers announce changes to its
 * text. `visuallyHidden` keeps it in the accessibility tree without showing it.
 */
export default function StatusRegion({ visuallyHidden = false, className, children, ...rest }) {
  return (
    <div role="status" aria-atomic="true" className={cx(visuallyHidden && 'sr-only', className)} {...rest}>
      {children}
    </div>
  );
}
