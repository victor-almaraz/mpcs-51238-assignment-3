'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { cx, focusRing, panelShadow } from '@/design-systems/industrial/classes';

/**
 * Clip context menu (WAI-ARIA APG menu): opens at `x`, `y` (viewport
 * pixels) with focus on its first item. Up/Down and Home/End move between
 * items, Enter or Space runs one, Escape or Tab closes, and focus returns to
 * `returnFocus` (the clip row, or the timeline). `items` are { label, run }
 * with an optional `note` that says why a command will not work.
 */
export default function ClipMenu({ label, x, y, items, onClose, returnFocus }) {
  const menuRef = useRef(null);
  const itemRefs = useRef([]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    // Keep the menu inside the viewport.
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - rect.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - rect.height - 4))}px`;
    itemRefs.current[0]?.focus();
  }, [x, y]);

  useEffect(() => {
    function onPointerDown(e) {
      if (!menuRef.current?.contains(e.target)) close(false);
    }
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  });

  function close(restore = true) {
    onClose();
    if (restore) returnFocus?.focus();
  }

  function onKeyDown(e) {
    const els = itemRefs.current.filter(Boolean);
    const i = els.indexOf(document.activeElement);
    let next = null;
    if (e.key === 'ArrowDown') next = (i + 1) % els.length;
    else if (e.key === 'ArrowUp') next = (i - 1 + els.length) % els.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = els.length - 1;
    else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    } else if (e.key === 'Tab') {
      e.preventDefault();
      close();
      return;
    } else return;
    e.preventDefault();
    els[next]?.focus();
  }

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cx('fixed z-50 flex min-w-56 flex-col rounded-ds border border-fg bg-surface py-1', panelShadow)}
      style={{ left: x, top: y }}
    >
      {items.map((item, i) => (
        <button
          key={item.label}
          ref={(el) => {
            itemRefs.current[i] = el;
          }}
          type="button"
          role="menuitem"
          tabIndex={-1}
          onClick={() => {
            close();
            item.run();
          }}
          className={cx('flex min-h-8 flex-col items-start px-3 py-1 text-left text-sm hover:bg-hover focus:bg-selected focus:text-selected-fg', focusRing)}
        >
          <span>{item.label}</span>
          {item.note ? <span className="text-xs opacity-80">{item.note}</span> : null}
        </button>
      ))}
    </div>
  );
}
