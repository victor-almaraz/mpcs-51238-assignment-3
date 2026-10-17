'use client';

import { useRef } from 'react';
import IconButton from '@/components/ui/IconButton';
import Icon from '@/components/ui/icons/Icon';
import { cx, focusRing } from '@/design-systems/industrial/classes';

const TABS = [
  { id: 'editor', label: 'Editor', icon: 'piano', help: 'Editor: the piano roll of the selected instrument track, or the selected audio clip.' },
  { id: 'devices', label: 'Devices', icon: 'sliders-horizontal', help: 'Devices: the instrument and effects of the selected track, or the master chain.' },
  { id: 'mixer', label: 'Mixer', icon: 'sliders-vertical', help: 'Mixer: volume, pan, mute and solo of every track and the master.' },
];

/** Dock height limits, CSS px. */
export const DOCK_MIN = 200;
const DOCK_STEP = 40;

/**
 * The editor's lower dock: a tablist (Editor, Devices, Mixer; WAI-ARIA APG
 * tabs with automatic activation) over the active panel, and a separator
 * above it that resizes the dock by pointer or by Up and Down keys. Only the
 * active panel is mounted. The dock collapses to its tab strip, giving the
 * arrangement the space: by the collapse button (aria-expanded) or a click on
 * the active tab; a click on any tab while collapsed expands it.
 * `onCollapse(collapsed)` reports the change.
 */
export default function Dock({ tab, onTab, collapsed, onCollapse, height, maxHeight, onHeight, children }) {
  const tabRefs = useRef([]);
  const drag = useRef(null);
  const clamp = (h) => Math.max(DOCK_MIN, Math.min(maxHeight, Math.round(h)));

  function onTabKey(e, i) {
    let next = null;
    if (e.key === 'ArrowRight') next = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    else return;
    e.preventDefault();
    onTab(TABS[next].id);
    tabRefs.current[next]?.focus();
  }

  function onSeparatorKey(e) {
    if (e.key === 'ArrowUp') onHeight(clamp(height + DOCK_STEP));
    else if (e.key === 'ArrowDown') onHeight(clamp(height - DOCK_STEP));
    else if (e.key === 'Home') onHeight(DOCK_MIN);
    else if (e.key === 'End') onHeight(maxHeight);
    else return;
    e.preventDefault();
  }

  return (
    <div className="flex shrink-0 flex-col border-t-2 border-fg bg-bg" style={collapsed ? undefined : { height }}>
      <div
        hidden={collapsed}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize the panels"
        aria-valuenow={height}
        aria-valuemin={DOCK_MIN}
        aria-valuemax={maxHeight}
        tabIndex={0}
        data-help="Drag, or press Up and Down, to resize the panels."
        onKeyDown={onSeparatorKey}
        onPointerDown={(e) => {
          drag.current = { y0: e.clientY, h0: height };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current) onHeight(clamp(drag.current.h0 - (e.clientY - drag.current.y0)));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        className={cx('group flex h-2 shrink-0 cursor-row-resize items-center justify-center bg-surface-2 hover:bg-hover', focusRing)}
      >
        <span aria-hidden="true" className="h-0.5 w-10 rounded-full bg-border-strong group-hover:bg-fg" />
      </div>
      <div className="flex h-9 shrink-0 items-stretch gap-1 border-b border-border bg-surface-2 px-2">
        <div role="tablist" aria-label="Panels" className="flex items-stretch gap-1">
          {TABS.map((t, i) => {
            const selected = t.id === tab;
            return (
              <button
                key={t.id}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`dock-tab-${t.id}`}
                aria-selected={selected}
                aria-controls={`dock-panel-${t.id}`}
                tabIndex={selected ? 0 : -1}
                data-help={t.help}
                onClick={() => {
                  if (collapsed) onCollapse(false);
                  else if (selected) onCollapse(true);
                  if (!selected) onTab(t.id);
                }}
                onKeyDown={(e) => onTabKey(e, i)}
                className={cx(
                  // Underline tabs: the open panel's tab has full-contrast text and a 2 px rule along its bottom edge.
                  'relative flex items-center gap-1.5 px-3 text-sm transition-colors',
                  "after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:content-['']",
                  selected && !collapsed ? 'text-fg after:bg-fg' : 'text-muted hover:text-fg after:bg-transparent hover:after:bg-border-strong',
                  focusRing,
                )}
              >
                <Icon name={t.icon} className="size-4" />
                {t.label}
              </button>
            );
          })}
        </div>
        <IconButton
          icon={collapsed ? 'panel-bottom-open' : 'panel-bottom-close'}
          label="Panels"
          data-tip={collapsed ? 'Expand the panels' : 'Collapse the panels'}
          variant="ghost"
          size="sm"
          aria-expanded={!collapsed}
          aria-controls={`dock-panel-${tab}`}
          onClick={() => onCollapse(!collapsed)}
          data-help="Collapse or expand the panels; a click on the open tab does the same."
          className="my-auto ml-auto"
        />
      </div>
      <div
        hidden={collapsed}
        role="tabpanel"
        id={`dock-panel-${tab}`}
        aria-labelledby={`dock-tab-${tab}`}
        className="relative flex min-h-0 flex-1 flex-col overflow-auto p-3"
      >
        {collapsed ? null : children}
      </div>
    </div>
  );
}
