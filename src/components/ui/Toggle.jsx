import {
  buttonVariants,
  controlBase,
  controlSizes,
  cx,
  lamp,
  lampOff,
  selectedLook,
  unselectedLook,
} from '@/design-systems/industrial/classes';

/**
 * Toggle button with an indicator lamp that lights while pressed. The visible
 * text is the constant name; state is exposed only through aria-pressed.
 * `highlighted` draws an unpressed toggle as the primary action (signal orange).
 */
export default function Toggle({ pressed = false, highlighted = false, size = 'md', className, ref, ...rest }) {
  let look = unselectedLook;
  if (pressed) look = selectedLook;
  else if (highlighted) look = cx(buttonVariants.primary, lampOff);
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={pressed ? 'true' : 'false'}
      className={cx(controlBase, lamp, controlSizes[size] ?? controlSizes.md, look, className)}
      {...rest}
    />
  );
}
