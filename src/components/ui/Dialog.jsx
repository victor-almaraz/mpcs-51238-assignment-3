'use client';

import { useEffect, useId, useImperativeHandle, useRef } from 'react';
import { cx, focusRing, panelShadow } from '@/design-systems/industrial/classes';

/** True when pointer or mouse event `e` lands on the backdrop: it targets the dialog itself, outside its box. */
function onBackdrop(e) {
  if (e.target !== e.currentTarget) return false;
  const r = e.currentTarget.getBoundingClientRect();
  return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
}

/**
 * Modal native <dialog> named by its heading (aria-labelledby).
 * `open` drives showModal()/close(). On open, focus moves inside: to
 * `initialFocusRef` when given, otherwise to the browser's default target.
 * Escape is reported through onClose so the parent owns the state. On close,
 * focus returns to `returnFocusRef` when given, otherwise to the element that
 * had focus before the dialog opened. (Safari does not focus buttons on click,
 * so callers opening a dialog from a button pass it as `returnFocusRef`.)
 * With `closeOnBackdrop`, a click whose press and release both land on the
 * backdrop reports onClose; a press inside the dialog released over the
 * backdrop does not. `ref` exposes the <dialog> element.
 */
export default function Dialog({
  open,
  onClose,
  title,
  children,
  actions,
  initialFocusRef,
  returnFocusRef,
  className,
  closeOnBackdrop = false,
  ref,
  ...rest
}) {
  const dialogRef = useRef(null);
  const restoreFocusRef = useRef(null);
  const backdropPressRef = useRef(false);
  const openRef = useRef(open);
  const onCloseRef = useRef(onClose);
  const titleId = useId();

  useImperativeHandle(ref, () => dialogRef.current, []);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    openRef.current = open;
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      restoreFocusRef.current = returnFocusRef?.current ?? document.activeElement;
      dialog.showModal();
      initialFocusRef?.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, initialFocusRef, returnFocusRef]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    function handleCancel(e) {
      e.preventDefault();
      onCloseRef.current?.();
    }
    function handleClose() {
      // The close event is a later task: a dialog reopened before it arrives stays open.
      if (dialog.open) return;
      const target = restoreFocusRef.current;
      restoreFocusRef.current = null;
      if (target?.isConnected) target.focus();
      if (openRef.current) onCloseRef.current?.();
    }
    dialog.addEventListener('cancel', handleCancel);
    dialog.addEventListener('close', handleClose);
    return () => {
      dialog.removeEventListener('cancel', handleCancel);
      dialog.removeEventListener('close', handleClose);
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className={cx(
        'm-auto w-[min(28rem,calc(100%_-_2rem))] max-w-none rounded-ds border border-border-strong border-t-4 border-t-fg bg-surface p-5 text-sm text-fg',
        panelShadow,
        'backdrop:bg-[rgb(30_32_26/0.55)]',
        className,
      )}
      onPointerDown={
        closeOnBackdrop
          ? (e) => {
              backdropPressRef.current = onBackdrop(e);
            }
          : undefined
      }
      onClick={
        closeOnBackdrop
          ? (e) => {
              const pressed = backdropPressRef.current;
              backdropPressRef.current = false;
              if (pressed && onBackdrop(e)) onClose?.();
            }
          : undefined
      }
      {...rest}
    >
      <div className="flex flex-col gap-4">
        <h2
          id={titleId}
          className={cx('rounded-ds font-sans text-sm leading-tight font-bold uppercase', focusRing)}
        >
          {title}
        </h2>
        <div className="flex flex-col gap-2">{children}</div>
        {actions ? <div className="flex flex-wrap justify-end gap-2">{actions}</div> : null}
      </div>
    </dialog>
  );
}
