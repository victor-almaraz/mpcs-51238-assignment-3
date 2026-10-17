import {
  buttonVariants,
  controlBase,
  controlSizes,
  cx,
  lamp,
  lampOff,
  lampOn,
  selectedLook,
  unselectedLook,
} from '@/design-systems/industrial/classes';

/**
 * Toggle button; `lamp` adds an indicator lamp that lights while pressed (transport only). The visible
 * text is the constant name; state is exposed only through aria-pressed.
 * `highlighted` draws an unpressed toggle as the primary action (signal orange).
 */
export default function Toggle({ pressed = false, highlighted = false, lamp: lit = false, size = 'md', className, ref, ...rest }) {
  let look = unselectedLook;
  if (pressed) look = selectedLook;
  else if (highlighted) look = buttonVariants.primary;
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={pressed ? 'true' : 'false'}
      // Top padding keeps the lamp clear of the legend.
      className={cx(controlBase, controlSizes[size] ?? controlSizes.md, lit && cx(lamp, 'pt-2', pressed ? lampOn : lampOff), look, className)}
      {...rest}
    />
  );
}
