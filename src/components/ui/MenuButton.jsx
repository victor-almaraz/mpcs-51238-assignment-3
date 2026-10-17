'use client';

import { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '@/components/ui/icons/Icon';
import { buttonVariants, controlBase, controlSizes, cx } from '@/design-systems/industrial/classes';
import Menu from './Menu';

/**
 * Menu button (WAI-ARIA APG menu button): a button named `label`, with the
 * optional Lucide `icon`, that opens a Menu of `items` (see Menu.jsx) below
 * itself. Enter, Space and Down open it on the first item; Up opens it on
 * the last. `items` may be a function, read when the menu opens. The menu
 * renders in the enclosing <main> (its landmark), outside any transformed or
 * scrolling ancestor that would move or clip it.
 */
export default function MenuButton({ label, icon, items, size = 'sm', variant = 'secondary', className, help, ...rest }) {
  const [open, setOpen] = useState(null); // { x, y, focusLast, anchor }
  const buttonRef = useRef(null);
  const menuId = useId();

  function show(focusLast = false) {
    const r = buttonRef.current.getBoundingClientRect();
    const anchor = buttonRef.current;
    setOpen({ x: r.left, y: r.bottom + 2, focusLast, anchor, host: anchor.closest('main') ?? document.body });
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open ? 'true' : 'false'}
        aria-controls={open ? menuId : undefined}
        data-help={help}
        onClick={() => (open ? setOpen(null) : show())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            show(e.key === 'ArrowUp');
          }
        }}
        className={cx(controlBase, controlSizes[size] ?? controlSizes.sm, buttonVariants[variant] ?? buttonVariants.secondary, className)}
        {...rest}
      >
        {icon ? <Icon name={icon} /> : null}
        {label}
        <Icon name="chevron-down" className="size-3.5" />
      </button>
      {open
        ? createPortal(
            <Menu
              id={menuId}
              label={label}
              x={open.x}
              y={open.y}
              focusLast={open.focusLast}
              items={typeof items === 'function' ? items() : items}
              returnFocus={open.anchor}
              onClose={() => setOpen(null)}
            />,
            open.host,
          )
        : null}
    </>
  );
}
