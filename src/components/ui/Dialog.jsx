'use client';

import { useEffect, useId, useImperativeHandle, useRef } from 'react';
import { cx, focusRing, panelShadow } from '@/design-systems/industrial/classes';

/**
 * Modal native <dialog> named by its heading (aria-labelledby).
 * `open` drives showModal()/close(). On open, focus moves inside: to
 * `initialFocusRef` when given, otherwise to the browser's default target.
 * Escape is reported through onClose so the parent owns the state. On close,
 * focus returns to the element that had it before the dialog opened.
 * `ref` exposes the <dialog> element.
 */
export default function Dialog({ open, onClose, title, children, actions, initialFocusRef, className, ref, ...rest }) {
  const dialogRef = useRef(null);
  const returnFocusRef = useRef(null);
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
      returnFocusRef.current = document.activeElement;
      dialog.showModal();
      initialFocusRef?.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, initialFocusRef]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    function handleCancel(e) {
      e.preventDefault();
      onCloseRef.current?.();
    }
    function handleClose() {
      const target = returnFocusRef.current;
      returnFocusRef.current = null;
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
