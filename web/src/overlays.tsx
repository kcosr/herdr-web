import type * as React from "react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  focusNextTo,
  focusOverlayTrigger,
  trapFocusWithin,
  useFocusReturn,
} from "./overlayFocus";

export type MenuItem = { key: string; label: string; danger?: boolean };

/**
 * Long-press (touch / mouse-hold) and right-click both open a context menu;
 * a plain tap/click runs the row's normal select action.
 */
export function useLongPress(
  onLong: (x: number, y: number) => void,
  onTap?: (x: number, y: number) => void,
) {
  const timer = useRef<number | undefined>(undefined);
  const longFired = useRef(false);
  const start = useRef<{ x: number; y: number } | null>(null);

  const clear = () => {
    if (timer.current !== undefined) {
      window.clearTimeout(timer.current);
      timer.current = undefined;
    }
  };

  return {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (event.button === 2) {
        return;
      }
      longFired.current = false;
      start.current = { x: event.clientX, y: event.clientY };
      clear();
      const { clientX, clientY } = event;
      const trigger = event.currentTarget;
      timer.current = window.setTimeout(() => {
        longFired.current = true;
        focusOverlayTrigger(trigger);
        onLong(clientX, clientY);
      }, 480);
    },
    onPointerMove: (event: React.PointerEvent) => {
      const origin = start.current;
      if (!origin) {
        return;
      }
      if (Math.abs(event.clientX - origin.x) > 10 || Math.abs(event.clientY - origin.y) > 10) {
        clear();
      }
    },
    onPointerUp: () => clear(),
    onPointerCancel: () => clear(),
    onPointerLeave: () => clear(),
    onClick: (event: React.MouseEvent<HTMLElement>) => {
      if (longFired.current) {
        event.preventDefault();
        event.stopPropagation();
        longFired.current = false;
        return;
      }
      if (onTap) {
        focusOverlayTrigger(event.currentTarget);
        const rect = event.currentTarget.getBoundingClientRect();
        onTap(rect.left, rect.bottom);
      }
    },
    onContextMenu: (event: React.MouseEvent<HTMLElement>) => {
      event.preventDefault();
      focusOverlayTrigger(event.currentTarget);
      onLong(event.clientX, event.clientY);
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      const directActivation =
        Boolean(onTap) &&
        event.currentTarget.tagName !== "BUTTON" &&
        (event.key === "Enter" || event.key === " ");
      if (
        !directActivation &&
        event.key !== "ContextMenu" &&
        !(event.shiftKey && event.key === "F10")
      ) {
        return;
      }
      event.preventDefault();
      focusOverlayTrigger(event.currentTarget);
      const rect = event.currentTarget.getBoundingClientRect();
      if (directActivation) {
        onTap?.(rect.left, rect.bottom);
      } else {
        onLong(rect.left, rect.bottom);
      }
    },
  };
}

export function ActionMenu({
  x,
  y,
  title,
  items,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  title?: string;
  items: MenuItem[];
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const { targetRef: returnFocusRef, skipFocusReturn } = useFocusReturn();
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const titleId = useId();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const margin = 8;
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - margin) {
      left = window.innerWidth - margin - rect.width;
    }
    if (top + rect.height > window.innerHeight - margin) {
      top = window.innerHeight - margin - rect.height;
    }
    setPos({ left: Math.max(margin, left), top: Math.max(margin, top) });
  }, [x, y]);

  useLayoutEffect(() => {
    if (!pos) {
      return;
    }
    const firstItem = ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]');
    (firstItem ?? ref.current)?.focus();
  }, [pos]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      const moved = focusNextTo(returnFocusRef.current, overlayRef.current, event.shiftKey);
      if (moved) {
        skipFocusReturn();
      }
      onClose();
      return;
    }
    if (
      event.key !== "ArrowDown" &&
      event.key !== "ArrowUp" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const menuItems = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    );
    if (menuItems.length === 0) {
      return;
    }
    const activeIndex = menuItems.findIndex((item) => item === document.activeElement);
    const lastIndex = menuItems.length - 1;
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? lastIndex
          : event.key === "ArrowDown"
            ? activeIndex < 0 || activeIndex === lastIndex
              ? 0
              : activeIndex + 1
            : activeIndex <= 0
              ? lastIndex
              : activeIndex - 1;
    setFocusedIndex(nextIndex);
    menuItems[nextIndex]?.focus();
  };

  return (
    <div ref={overlayRef} className="overlay-root">
      <button
        className="overlay-scrim"
        type="button"
        tabIndex={-1}
        aria-label="Dismiss menu"
        onClick={onClose}
      />
      <div
        ref={ref}
        className="menu"
        role="menu"
        aria-label={title ? undefined : "Actions"}
        aria-labelledby={title ? titleId : undefined}
        tabIndex={items.length === 0 ? -1 : undefined}
        onKeyDown={onMenuKeyDown}
        style={{
          left: pos?.left ?? x,
          top: pos?.top ?? y,
          visibility: pos ? "visible" : "hidden",
        }}
      >
        {title ? (
          <div id={titleId} className="menu-title">
            {title}
          </div>
        ) : null}
        {items.map((item, index) => (
          <button
            key={item.key}
            className="menu-item"
            type="button"
            role="menuitem"
            tabIndex={index === focusedIndex ? 0 : -1}
            data-danger={item.danger || undefined}
            onFocus={() => setFocusedIndex(index)}
            onClick={() => onPick(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function RenameDialog({
  title,
  initial,
  placeholder,
  busy,
  onCancel,
  onSubmit,
  onClear,
}: {
  title: string;
  initial: string;
  placeholder?: string;
  busy?: boolean;
  onCancel: () => void;
  onSubmit: (value: string) => void;
  onClear?: () => void;
}) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useFocusReturn();
  const titleId = useId();

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (trimmed) {
      onSubmit(trimmed);
    }
  };

  return (
    <div className="overlay-root">
      <button
        className="overlay-scrim"
        type="button"
        tabIndex={-1}
        aria-label="Cancel"
        onClick={onCancel}
      />
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={submit}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
            return;
          }
          trapFocusWithin(event);
        }}
      >
        <div id={titleId} className="modal-title">
          {title}
        </div>
        <input
          ref={inputRef}
          className="field"
          value={value}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setValue(event.target.value)}
        />
        <div className="modal-actions">
          {onClear ? (
            <button type="button" className="btn btn-clear" disabled={busy} onClick={onClear}>
              Clear name
            </button>
          ) : null}
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !value.trim()}>
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  message?: string;
  confirmLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useFocusReturn();
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <div className="overlay-root">
      <button
        className="overlay-scrim"
        type="button"
        tabIndex={-1}
        aria-label="Cancel"
        onClick={onCancel}
      />
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={message ? messageId : undefined}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          } else if (
            event.key === "Enter" &&
            !busy &&
            !(event.target instanceof HTMLButtonElement)
          ) {
            event.preventDefault();
            onConfirm();
          }
          trapFocusWithin(event);
        }}
      >
        <div id={titleId} className="modal-title">
          {title}
        </div>
        {message ? (
          <div id={messageId} className="modal-message">
            {message}
          </div>
        ) : null}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
