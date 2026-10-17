'use client';

import { useEffect, useRef, useState } from 'react';
import { cx, panelShadow } from '@/design-systems/industrial/classes';

/** Delay before a tooltip shows on hover or keyboard focus, ms. */
const SHOW_DELAY_MS = 400;
/** Time the pointer has to cross from the element to the tooltip, ms. */
const LEAVE_GRACE_MS = 250;
const GAP = 6;

/**
 * The shared tooltip (HELP-01, WCAG 1.4.13) for every element with
 * `data-tip`: the control's name with its shortcut ("Play (Space)"). It shows
 * after a short delay on hover or keyboard focus, below the element (above it
 * near the bottom of the window); it stays while the pointer is over the
 * element or the tooltip itself, and Escape, pointer exit, blur and scrolling
 * dismiss it. It is visual only: icon controls carry their name in
 * aria-label and their shortcut as a description (IconButton). One fixed
 * layer serves the page, so scrolling toolbars do not clip it.
 */
export default function TooltipLayer() {
  const [tip, setTip] = useState(null); // { text, x, y, above }
  const timer = useRef(0);
  const leaving = useRef(0);
  const target = useRef(null);
  const layer = useRef(null);

  useEffect(() => {
    // WebKit does not report :focus-visible for scripted focus, so input modality is tracked here.
    let keyboard = false;
    function show(el) {
      if (!el.isConnected) return;
      const rect = el.getBoundingClientRect();
      const above = rect.bottom + 40 > window.innerHeight;
      const x = Math.max(72, Math.min(window.innerWidth - 72, rect.left + rect.width / 2));
      setTip({ text: el.dataset.tip, x, y: above ? rect.top - GAP : rect.bottom + GAP, above });
    }
    function hide() {
      clearTimeout(timer.current);
      clearTimeout(leaving.current);
      target.current = null;
      setTip(null);
    }
    function schedule(el) {
      hide();
      target.current = el;
      timer.current = setTimeout(() => show(el), SHOW_DELAY_MS);
    }
    function onOver(e) {
      // The pointer may move onto the tooltip without dismissing it.
      if (layer.current?.contains(e.target)) {
        clearTimeout(leaving.current);
        return;
      }
      const el = e.target.closest?.('[data-tip]');
      if (el && el === target.current) {
        clearTimeout(leaving.current);
        return;
      }
      if (el) schedule(el);
      else if (target.current) {
        clearTimeout(leaving.current);
        leaving.current = setTimeout(hide, LEAVE_GRACE_MS);
      }
    }
    function onFocus(e) {
      const el = e.target.closest?.('[data-tip]');
      if (el && keyboard) schedule(el);
      else hide();
    }
    function onKey(e) {
      keyboard = true;
      if (e.key === 'Escape') hide();
    }
    function onPointer(e) {
      keyboard = false;
      if (!layer.current?.contains(e.target)) hide();
    }
    document.addEventListener('pointerover', onOver);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', hide);
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', hide, true);
    return () => {
      clearTimeout(timer.current);
      clearTimeout(leaving.current);
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', hide, true);
    };
  }, []);

  if (!tip) return null;
  return (
    <div
      ref={layer}
      aria-hidden="true"
      className={cx('fixed z-[60] max-w-64 rounded-ds border border-fg bg-surface px-2 py-1 text-xs whitespace-nowrap text-fg', panelShadow)}
      style={{ left: tip.x, top: tip.y, transform: `translate(-50%, ${tip.above ? '-100%' : '0'})` }}
    >
      {tip.text}
    </div>
  );
}
