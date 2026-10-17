'use client';

import { useId } from 'react';
import Icon from '@/components/ui/icons/Icon';
import { buttonVariants, controlBase, cx, iconSizes } from '@/design-systems/industrial/classes';

/** Tooltip text for an icon control: "Loop (L)". */
export const tipText = (label, shortcut) => (shortcut ? `${label} (${shortcut})` : label);

/**
 * The aria-describedby value and hidden description for `shortcut` on an icon
 * control: the shortcut is described ("Shortcut: L"), never repeated in the
 * name, and controls without one get no description.
 */
export function useShortcutDescription(shortcut, describedBy) {
  const id = useId();
  const ids = [describedBy, shortcut ? id : null].filter(Boolean).join(' ') || undefined;
  const node = shortcut ? (
    <span id={id} hidden>
      Shortcut: {shortcut}
    </span>
  ) : null;
  return [ids, node];
}

/**
 * Button whose only content is the Lucide icon `icon` (or a glyph in
 * `children`). `label` is required and becomes the accessible name; the
 * shared tooltip (TooltipLayer) shows it with `shortcut`, which is also the
 * button's description. A missing label throws outside production builds.
 */
export default function IconButton({ icon, label, shortcut, variant = 'secondary', size = 'md', children, className, ref, 'aria-describedby': describedBy, ...rest }) {
  if (process.env.NODE_ENV !== 'production' && !label) {
    throw new Error('IconButton requires a non-empty label prop.');
  }
  const [ids, description] = useShortcutDescription(shortcut, describedBy);
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-describedby={ids}
      data-tip={tipText(label, shortcut)}
      className={cx(controlBase, iconSizes[size] ?? iconSizes.md, 'p-0', buttonVariants[variant] ?? buttonVariants.secondary, className)}
      {...rest}
    >
      {icon ? <Icon name={icon} /> : <span aria-hidden="true">{children}</span>}
      {description}
    </button>
  );
}
