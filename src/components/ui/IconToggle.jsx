'use client';

import Icon from '@/components/ui/icons/Icon';
import { buttonVariants, controlBase, cx, iconSizes, lamp, lampOff, lampOn, selectedLook, unselectedLook } from '@/design-systems/industrial/classes';
import { tipText, useShortcutDescription } from './IconButton';

/**
 * Toggle button showing the Lucide icon `icon`, on an ink cap while pressed.
 * `lamp` adds an indicator lamp that lights while pressed (transport toggles only). `label` is the constant accessible
 * name; state is exposed through aria-pressed. `highlighted` draws an
 * unpressed toggle as the primary action.
 */
export default function IconToggle({ icon, label, shortcut, pressed = false, highlighted = false, lamp: lit = false, size = 'md', className, ref, 'aria-describedby': describedBy, ...rest }) {
  const [ids, description] = useShortcutDescription(shortcut, describedBy);
  let look = unselectedLook;
  if (pressed) look = selectedLook;
  else if (highlighted) look = buttonVariants.primary;
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={pressed ? 'true' : 'false'}
      aria-describedby={ids}
      data-tip={tipText(label, shortcut)}
      // With a lamp, top padding keeps the icon clear of it.
      className={cx(controlBase, iconSizes[size] ?? iconSizes.md, 'px-1.5', lit ? cx(lamp, 'pt-2 pb-1', pressed ? lampOn : lampOff) : 'py-1', look, className)}
      {...rest}
    >
      <Icon name={icon} />
      {description}
    </button>
  );
}
