'use client';

import { useRef } from 'react';
import IconButton from '@/components/ui/IconButton';
import { cx, focusRing } from '@/design-systems/industrial/classes';

const TABS = [
  { id: 'editor', label: 'Editor', help: 'Editor: the piano roll of the selected instrument track, or the selected audio clip.' },
  { id: 'devices', label: 'Devices', help: 'Devices: the instrument and effects of the selected track, or the master chain.' },
  { id: 'mixer', label: 'Mixer', help: 'Mixer: volume, pan, mute and solo of every track and the master.' },
];

/** Dock height limits, CSS px. */
export const DOCK_MIN = 160;
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
        className={cx('h-2 shrink-0 cursor-row-resize bg-border hover:bg-border-strong', focusRing)}
      />
      <div className="flex shrink-0 items-end gap-1 border-b border-border-strong bg-surface-2 px-3 pt-1">
        <div role="tablist" aria-label="Panels" className="flex gap-1">
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
                  'min-h-8 rounded-t-ds border border-b-0 px-4 text-xs font-bold tracking-[0.06em] uppercase',
                  selected ? 'border-fg bg-bg text-fg' : 'border-transparent text-muted hover:bg-hover',
                  focusRing,
                )}
              >
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
          className="mb-1 ml-auto"
        />
      </div>
      <div
        hidden={collapsed}
        role="tabpanel"
        id={`dock-panel-${tab}`}
        aria-labelledby={`dock-tab-${tab}`}
        className="flex min-h-0 flex-1 flex-col overflow-auto p-3"
      >
        {collapsed ? null : children}
      </div>
    </div>
  );
}
