'use client';

import { cx } from '@/design-systems/industrial/classes';

const FOCUSABLE = 'button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex="0"]';
/** Controls whose own arrow keys must keep working. */
const OWN_ARROWS = 'input, select, textarea';

/**
 * role="toolbar" with arrow-key movement between controls (WAI-ARIA APG
 * toolbar): Left/Right and Home/End move focus, except inside text fields,
 * selects and sliders, which keep their own arrow keys.
 */
export default function Toolbar({ label, className, children, ...rest }) {
  function onKeyDown(e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    if (e.target.closest?.(OWN_ARROWS)) return;
    const items = [...e.currentTarget.querySelectorAll(FOCUSABLE)];
    const i = items.indexOf(e.target.closest?.(FOCUSABLE));
    if (i < 0) return;
    e.preventDefault();
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  }
  return (
    <div role="toolbar" aria-label={label} onKeyDown={onKeyDown} className={cx(className)} {...rest}>
      {children}
    </div>
  );
}
