import type * as React from "react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

export type MenuItem = { key: string; label: string; danger?: boolean };

export type OverlayInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not(:disabled)",
  "input:not(:disabled):not([type='hidden'])",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const visuallyHiddenStyle: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

/**
 * Long-press (touch / mouse-hold) and right-click both open a context menu;
 * a plain tap/click runs the row's normal select action.
 */
export function useLongPress(onLong: (x: number, y: number) => void, onTap?: () => void) {
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
    onPointerDown: (event: React.PointerEvent) => {
      if (event.button === 2) {
        return;
      }
      longFired.current = false;
      start.current = { x: event.clientX, y: event.clientY };
      clear();
      const { clientX, clientY } = event;
      timer.current = window.setTimeout(() => {
        longFired.current = true;
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
    onClick: (event: React.MouseEvent) => {
      if (longFired.current) {
        event.preventDefault();
        event.stopPropagation();
        longFired.current = false;
        return;
      }
      onTap?.();
    },
    onContextMenu: (event: React.MouseEvent) => {
      event.preventDefault();
      onLong(event.clientX, event.clientY);
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
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const titleId = useId();

  useLayoutEffect(() => {
    const updatePosition = () => {
      const el = ref.current;
      if (!el) {
        return;
      }
      const rect = el.getBoundingClientRect();
      setPos(
        clampActionMenuPosition({
          x,
          y,
          width: rect.width,
          height: rect.height,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          insets: overlaySafeAreaInsets(el.parentElement ?? el),
        }),
      );
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("resize", updatePosition);
    };
  }, [x, y]);

  useLayoutEffect(() => {
    const activeElement = document.activeElement;
    if (
      returnFocusRef.current === null &&
      activeElement instanceof HTMLElement &&
      activeElement !== document.body &&
      !ref.current?.contains(activeElement)
    ) {
      returnFocusRef.current = activeElement;
    }

    return () => {
      const returnTarget = returnFocusRef.current;
      if (returnTarget?.isConnected) {
        returnTarget.focus();
      }
    };
  }, []);

  // Focus only once the menu is positioned: while `pos` is null the menu is
  // visibility:hidden, and focusing a hidden element is a silent no-op in
  // real browsers (jsdom does not enforce this).
  const autoFocusedRef = useRef(false);
  useLayoutEffect(() => {
    if (!pos || autoFocusedRef.current) {
      return;
    }
    autoFocusedRef.current = true;
    const firstItem = ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]');
    if (firstItem) {
      firstItem.focus();
    } else {
      ref.current?.focus();
    }
  }, [pos]);

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
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
    let nextIndex: number;
    if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = menuItems.length - 1;
    } else if (event.key === "ArrowDown") {
      nextIndex = activeIndex < 0 ? 0 : (activeIndex + 1) % menuItems.length;
    } else {
      nextIndex =
        activeIndex < 0
          ? menuItems.length - 1
          : (activeIndex - 1 + menuItems.length) % menuItems.length;
    }

    setFocusedIndex(nextIndex);
    menuItems[nextIndex]?.focus();
  };

  return (
    <div className="overlay-root">
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

export function clampActionMenuPosition({
  x,
  y,
  width,
  height,
  viewportWidth,
  viewportHeight,
  insets,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  insets: OverlayInsets;
}) {
  const maximumLeft = Math.max(insets.left, viewportWidth - insets.right - width);
  const maximumTop = Math.max(insets.top, viewportHeight - insets.bottom - height);
  return {
    left: Math.min(Math.max(insets.left, x), maximumLeft),
    top: Math.min(Math.max(insets.top, y), maximumTop),
  };
}

export function overlaySafeAreaInsets(element: Element): OverlayInsets {
  const style = getComputedStyle(element);
  return {
    top: cssPixels(style.paddingTop, 16),
    right: cssPixels(style.paddingRight, 16),
    bottom: cssPixels(style.paddingBottom, 16),
    left: cssPixels(style.paddingLeft, 16),
  };
}

export function trapFocusWithin<T extends HTMLElement>(event: React.KeyboardEvent<T>) {
  if (event.key !== "Tab") {
    return;
  }
  const container = event.currentTarget;
  const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => element.getAttribute("aria-hidden") !== "true" && !element.hidden)
    .sort((left, right) => {
      if (left === right) {
        return 0;
      }
      return left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
  if (focusable.length === 0) {
    event.preventDefault();
    container.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  const focusOutsideItems = active === container || !container.contains(active);
  if (event.shiftKey && (active === first || focusOutsideItems)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || focusOutsideItems)) {
    event.preventDefault();
    first.focus();
  }
}

function cssPixels(value: string, fallback: number) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
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
  const dialogRef = useRef<HTMLFormElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const inputId = useId();

  useEffect(() => {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && activeElement !== document.body) {
      returnFocusRef.current = activeElement;
    }
    inputRef.current?.focus();
    inputRef.current?.select();

    return () => {
      const returnTarget = returnFocusRef.current;
      if (returnTarget?.isConnected) {
        returnTarget.focus();
      }
    };
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
        ref={dialogRef}
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
        <label htmlFor={inputId} style={visuallyHiddenStyle}>
          {title} name
        </label>
        <input
          id={inputId}
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
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && activeElement !== document.body) {
      returnFocusRef.current = activeElement;
    }
    dialogRef.current?.focus();

    return () => {
      const returnTarget = returnFocusRef.current;
      if (returnTarget?.isConnected) {
        returnTarget.focus();
      }
    };
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
