'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import Icon from '@/components/ui/icons/Icon';
import { cx, focusRing, panelShadow } from '@/design-systems/industrial/classes';
import { displayKeys } from '@/lib/commands/registry';

/** aria-keyshortcuts for `keys` ("Mod+S" → "Control+S Meta+S"). */
const keyShortcuts = (keys) => (keys.includes('Mod') ? `${keys.replace('Mod', 'Control')} ${keys.replace('Mod', 'Meta')}` : keys);

/**
 * Popup menu (WAI-ARIA APG menu): opens at `x`, `y` (viewport pixels) with
 * focus on its first item, or its last with `focusLast`. Up/Down and Home/End
 * move between items, Enter or Space runs one, Escape or Tab closes, and
 * focus returns to `returnFocus`. `items` are { label, run } with optional
 * `icon`, `keys` (shortcut text), `note` (why the command will not work) and
 * `disabled`; { separator: true } draws a rule. Focus returns before the item
 * runs, so a dialog an item opens returns focus to the same place.
 */
export default function Menu({ id, label, x, y, items, onClose, returnFocus, focusLast = false }) {
  const menuRef = useRef(null);
  const itemRefs = useRef([]);
  const actions = items.filter((item) => !item.separator);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    // Keep the menu inside the viewport.
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - rect.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - rect.height - 4))}px`;
    const els = itemRefs.current.slice(0, actions.length).filter(Boolean);
    (focusLast ? els[els.length - 1] : els[0])?.focus();
  }, [x, y, focusLast, actions.length]);

  useEffect(() => {
    function onPointerDown(e) {
      if (!menuRef.current?.contains(e.target) && !returnFocus?.contains?.(e.target)) close(false);
    }
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  });

  const stop = (e) => e.stopPropagation();

  function close(restore = true) {
    onClose();
    if (restore) returnFocus?.focus();
  }

  function onKeyDown(e) {
    const els = itemRefs.current.slice(0, actions.length).filter(Boolean);
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
      id={id}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      // React events bubble through portals; the menu's pointer events stay its own.
      onPointerDown={stop}
      onPointerMove={stop}
      onPointerUp={stop}
      onDoubleClick={stop}
      onContextMenu={stop}
      className={cx('fixed z-50 flex min-w-56 flex-col rounded-ds border border-fg bg-surface py-1', panelShadow)}
      style={{ left: x, top: y }}
    >
      {items.map((item, i) =>
        item.separator ? (
          <div key={`separator-${i}`} role="separator" className="my-1 h-px bg-border" />
        ) : (
          <button
            key={item.label}
            ref={(el) => {
              itemRefs.current[actions.indexOf(item)] = el;
            }}
            type="button"
            role="menuitem"
            tabIndex={-1}
            aria-disabled={item.disabled || undefined}
            aria-keyshortcuts={item.keys ? keyShortcuts(item.keys) : undefined}
            onClick={() => {
              if (item.disabled) return;
              close();
              item.run();
            }}
            className={cx(
              'flex min-h-8 items-center gap-2 px-3 py-1 text-left text-sm hover:bg-hover focus:bg-selected focus:text-selected-fg',
              item.disabled ? 'opacity-50' : '',
              focusRing,
            )}
          >
            {item.icon ? <Icon name={item.icon} /> : <span aria-hidden="true" className="w-4 shrink-0" />}
            <span className="flex flex-1 flex-col">
              <span>{item.label}</span>
              {item.note ? <span className="text-xs opacity-80">{item.note}</span> : null}
            </span>
            {item.keys ? (
              <kbd aria-hidden="true" className="font-mono text-xs opacity-80">
                {displayKeys(item.keys)}
              </kbd>
            ) : null}
          </button>
        ),
      )}
    </div>
  );
}
