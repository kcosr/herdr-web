import { useLayoutEffect, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not(:disabled)",
  "input:not(:disabled):not([type='hidden'])",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  "[contenteditable='true']",
  "[tabindex]",
].join(",");

export function focusableElements(container: ParentNode) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter(isFocusable)
    .sort((left, right) => {
      const leftTabIndex = left.tabIndex;
      const rightTabIndex = right.tabIndex;
      if (leftTabIndex > 0 || rightTabIndex > 0) {
        if (leftTabIndex <= 0) {
          return 1;
        }
        if (rightTabIndex <= 0) {
          return -1;
        }
        if (leftTabIndex !== rightTabIndex) {
          return leftTabIndex - rightTabIndex;
        }
      }
      return left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
}

export function trapFocusWithin<T extends HTMLElement>(event: ReactKeyboardEvent<T>) {
  if (event.key !== "Tab") {
    return;
  }

  const container = event.currentTarget;
  const focusable = focusableElements(container);
  if (focusable.length === 0) {
    event.preventDefault();
    container.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  const outside = active === container || !container.contains(active);
  if (event.shiftKey && (active === first || outside)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || outside)) {
    event.preventDefault();
    first.focus();
  }
}

export function useFocusReturn() {
  const targetRef = useRef<HTMLElement | null>(null);
  const restoreRef = useRef(true);

  useLayoutEffect(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) {
      targetRef.current = active;
    }

    return () => {
      const target = targetRef.current;
      if (restoreRef.current && target?.isConnected) {
        target.focus();
      }
    };
  }, []);

  return {
    targetRef,
    skipFocusReturn: () => {
      restoreRef.current = false;
    },
  };
}

export function focusNextTo(
  origin: HTMLElement | null,
  excludedRoot: HTMLElement | null,
  backwards: boolean,
) {
  if (!origin?.isConnected || !document.body) {
    return false;
  }

  const candidates = focusableElements(document.body).filter(
    (element) => !excludedRoot?.contains(element),
  );
  const originIndex = candidates.indexOf(origin);
  if (originIndex < 0 || candidates.length < 2) {
    return false;
  }

  const offset = backwards ? -1 : 1;
  const target = candidates[(originIndex + offset + candidates.length) % candidates.length];
  target.focus();
  return document.activeElement === target;
}

export function focusOverlayTrigger(trigger: HTMLElement) {
  trigger.focus({ preventScroll: true });
}

function isFocusable(element: HTMLElement) {
  if (element.tabIndex < 0 || element.closest("[hidden], [inert], [aria-hidden='true']")) {
    return false;
  }

  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const style = window.getComputedStyle(current);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }
  }
  return true;
}
