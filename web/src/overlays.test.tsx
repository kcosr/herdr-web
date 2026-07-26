/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActionMenu,
  clampActionMenuPosition,
  ConfirmDialog,
  RenameDialog,
} from "./overlays";

const roots: Root[] = [];

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount();
    }
  });
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("ActionMenu", () => {
  it("stays inside asymmetric safe-area insets", () => {
    expect(
      clampActionMenuPosition({
        x: 820,
        y: 370,
        width: 220,
        height: 180,
        viewportWidth: 844,
        viewportHeight: 390,
        insets: { top: 16, right: 59, bottom: 21, left: 59 },
      }),
    ).toEqual({ left: 565, top: 189 });
  });

  it("focuses the first item and supports menu keyboard navigation", async () => {
    const opener = document.createElement("button");
    opener.textContent = "Open actions";
    document.body.appendChild(opener);
    opener.focus();
    const onClose = vi.fn();

    const { container } = await render(
      <ActionMenu
        x={20}
        y={30}
        title="Pane actions"
        items={[
          { key: "rename", label: "Rename" },
          { key: "duplicate", label: "Duplicate" },
          { key: "delete", label: "Delete", danger: true },
        ]}
        onPick={vi.fn()}
        onClose={onClose}
      />,
    );
    const menu = requiredElement<HTMLDivElement>(container, '[role="menu"]');
    const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    const scrim = requiredElement<HTMLButtonElement>(container, ".overlay-scrim");

    expect(menu.getAttribute("aria-labelledby")).toBe(
      requiredElement(container, ".menu-title").id,
    );
    expect(scrim.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(items[0]);

    await press(items[0], "ArrowDown");
    expect(document.activeElement).toBe(items[1]);

    await press(items[1], "End");
    expect(document.activeElement).toBe(items[2]);

    await press(items[2], "ArrowDown");
    expect(document.activeElement).toBe(items[0]);

    await press(items[0], "ArrowUp");
    expect(document.activeElement).toBe(items[2]);

    await press(items[2], "Home");
    expect(document.activeElement).toBe(items[0]);

    const escape = await press(items[0], "Escape");
    expect(escape.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();

    onClose.mockClear();
    const tab = await press(items[0], "Tab");
    expect(tab.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("reclamps an open menu when the viewport resizes", async () => {
    let menuWidth = 200;
    vi.spyOn(window.HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const width = this.classList.contains("menu") ? menuWidth : 0;
      return {
        x: 0,
        y: 0,
        width,
        height: 100,
        top: 0,
        right: width,
        bottom: 100,
        left: 0,
        toJSON: () => ({}),
      };
    });

    const { container } = await render(
      <ActionMenu
        x={window.innerWidth}
        y={20}
        items={[{ key: "rename", label: "Rename" }]}
        onPick={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const menu = requiredElement<HTMLDivElement>(container, '[role="menu"]');
    const initialLeft = menu.style.left;

    menuWidth = 300;
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(menu.style.left).not.toBe(initialLeft);
    expect(Number.parseFloat(menu.style.left)).toBeLessThanOrEqual(window.innerWidth - menuWidth);
  });

  it("restores focus to the opener when the menu unmounts", async () => {
    const opener = document.createElement("button");
    opener.textContent = "Open actions";
    document.body.appendChild(opener);
    opener.focus();

    const { root } = await render(
      <ActionMenu
        x={20}
        y={30}
        items={[{ key: "rename", label: "Rename" }]}
        onPick={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(document.activeElement?.getAttribute("role")).toBe("menuitem");

    await act(async () => {
      root.render(null);
    });

    expect(document.activeElement).toBe(opener);
  });
});

describe("RenameDialog", () => {
  it("is a labelled modal dialog with a real input label", async () => {
    const onCancel = vi.fn();
    const { container } = await render(
      <RenameDialog
        title="Rename pane"
        initial="Build"
        onCancel={onCancel}
        onSubmit={vi.fn()}
      />,
    );
    const dialog = requiredElement<HTMLFormElement>(container, '[role="dialog"]');
    const title = requiredElement(container, ".modal-title");
    const input = requiredElement<HTMLInputElement>(container, "input.field");
    const label = requiredElement<HTMLLabelElement>(container, "label");

    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBe(title.id);
    expect(label.htmlFor).toBe(input.id);
    expect(label.textContent).toBe("Rename pane name");
    expect(document.activeElement).toBe(input);

    const escape = await press(input, "Escape");
    expect(escape.defaultPrevented).toBe(true);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("traps focus, removes the scrim from Tab order, and restores the opener", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { container, root } = await render(
      <RenameDialog
        title="Rename pane"
        initial="Build"
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    const input = requiredElement<HTMLInputElement>(container, "input.field");
    const buttons = Array.from(
      requiredElement<HTMLFormElement>(container, '[role="dialog"]').querySelectorAll("button"),
    );
    const last = buttons.at(-1);
    if (!last) {
      throw new Error("missing dialog action");
    }

    expect(requiredElement<HTMLButtonElement>(container, ".overlay-scrim").tabIndex).toBe(-1);
    await press(input, "Tab", { shiftKey: true });
    expect(document.activeElement).toBe(last);
    await press(last, "Tab");
    expect(document.activeElement).toBe(input);

    await act(async () => {
      root.render(null);
    });
    expect(document.activeElement).toBe(opener);
  });
});

describe("ConfirmDialog", () => {
  it("exposes its title and message as the modal dialog's accessible text", async () => {
    const { container } = await render(
      <ConfirmDialog
        title="Delete pane?"
        message="This cannot be undone."
        confirmLabel="Delete"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const dialog = requiredElement<HTMLDivElement>(container, '[role="dialog"]');
    const title = requiredElement(container, ".modal-title");
    const message = requiredElement(container, ".modal-message");

    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBe(title.id);
    expect(dialog.getAttribute("aria-describedby")).toBe(message.id);
    expect(document.activeElement).toBe(dialog);
  });

  it("keeps Tab focus in the dialog and restores focus after closing", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { container, root } = await render(
      <ConfirmDialog
        title="Delete pane?"
        confirmLabel="Delete"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const dialog = requiredElement<HTMLDivElement>(container, '[role="dialog"]');
    const actions = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button"));

    expect(requiredElement<HTMLButtonElement>(container, ".overlay-scrim").tabIndex).toBe(-1);
    await press(dialog, "Tab");
    expect(document.activeElement).toBe(actions[0]);
    await press(actions[0], "Tab", { shiftKey: true });
    expect(document.activeElement).toBe(actions.at(-1));
    await press(actions.at(-1) ?? actions[0], "Tab");
    expect(document.activeElement).toBe(actions[0]);

    await act(async () => {
      root.render(null);
    });
    expect(document.activeElement).toBe(opener);
  });
});

async function render(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);

  await act(async () => {
    root.render(node);
  });

  return { container, root };
}

async function press(target: HTMLElement, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    ...init,
    key,
    bubbles: true,
    cancelable: true,
  });
  await act(async () => {
    target.dispatchEvent(event);
  });
  return event;
}

function requiredElement<T extends Element = HTMLElement>(
  container: ParentNode,
  selector: string,
) {
  const element = container.querySelector<T>(selector);
  if (!element) {
    throw new Error(`missing element: ${selector}`);
  }
  return element;
}
