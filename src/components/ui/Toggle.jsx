import { controlBase, controlSizes, cx, lamp, selectedLook, unselectedLook } from '@/design-systems/industrial/classes';

/**
 * Toggle button with an indicator lamp that lights while pressed. The visible
 * text is the constant name; state is exposed only through aria-pressed.
 */
export default function Toggle({ pressed = false, size = 'md', className, ref, ...rest }) {
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={pressed ? 'true' : 'false'}
      className={cx(controlBase, lamp, controlSizes[size] ?? controlSizes.md, pressed ? selectedLook : unselectedLook, className)}
      {...rest}
    />
  );
}
