/**
 * @vitest-environment jsdom
 */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionMenu, ConfirmDialog, RenameDialog, useLongPress } from "./overlays";

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
  it("focuses the first item and supports standard menu navigation", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { container } = await render(
      <ActionMenu
        x={20}
        y={30}
        title="Pane actions"
        items={menuItems}
        onPick={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const menu = requiredElement<HTMLDivElement>(container, '[role="menu"]');
    const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));

    expect(menu.getAttribute("aria-labelledby")).toBe(
      requiredElement(container, ".menu-title").id,
    );
    expect(requiredElement<HTMLButtonElement>(container, ".overlay-scrim").tabIndex).toBe(-1);
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
  });

  it.each([
    { shiftKey: false, expected: "after" },
    { shiftKey: true, expected: "before" },
  ])("closes on Tab and moves focus $expected the opener", async ({ shiftKey, expected }) => {
    const before = pageButton("before");
    const opener = pageButton("opener");
    const after = pageButton("after");
    opener.focus();
    const onClose = vi.fn();
    const { container } = await render(<MenuHarness onClose={onClose} />);
    const firstItem = requiredElement<HTMLButtonElement>(container, '[role="menuitem"]');

    const event = await press(firstItem, "Tab", { shiftKey });

    expect(event.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(expected === "after" ? after : before);
  });

  it("restores focus to the opener when dismissed with Escape", async () => {
    const opener = pageButton("opener");
    opener.focus();
    const onClose = vi.fn();
    const { container } = await render(<MenuHarness onClose={onClose} />);
    const firstItem = requiredElement<HTMLButtonElement>(container, '[role="menuitem"]');

    const event = await press(firstItem, "Escape");

    expect(event.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(opener);
  });

  it("records the real pointer trigger before opening the menu", async () => {
    const unrelated = pageButton("unrelated");
    unrelated.focus();
    const { container } = await render(<PointerMenuHarness />);
    const trigger = requiredElement<HTMLButtonElement>(container, "[data-menu-trigger]");

    await act(async () => {
      trigger.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 20,
          clientY: 30,
        }),
      );
    });
    const firstItem = requiredElement<HTMLButtonElement>(container, '[role="menuitem"]');
    expect(document.activeElement).toBe(firstItem);

    await press(firstItem, "Escape");
    expect(document.activeElement).toBe(trigger);
  });

  it("opens a custom menu trigger consistently by click and keyboard", async () => {
    const { container } = await render(<CustomMenuTriggerHarness />);
    const trigger = requiredElement<HTMLElement>(container, "[data-custom-menu-trigger]");

    await act(async () => trigger.click());
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(
      requiredElement<HTMLButtonElement>(container, '[role="menuitem"]'),
    );

    await press(document.activeElement as HTMLElement, "Escape");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    trigger.focus();
    await press(trigger, "Enter");
    expect(document.activeElement).toBe(
      requiredElement<HTMLButtonElement>(container, '[role="menuitem"]'),
    );
  });
});

describe("RenameDialog", () => {
  it("labels the modal, traps focus, and restores its opener", async () => {
    const opener = pageButton("opener");
    opener.focus();
    const { container, root } = await render(
      <RenameDialog
        title="Rename pane"
        initial="Build"
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    const dialog = requiredElement<HTMLFormElement>(container, '[role="dialog"]');
    const input = requiredElement<HTMLInputElement>(dialog, "input");
    const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button"));
    const last = buttons.at(-1);
    if (!last) {
      throw new Error("missing dialog action");
    }

    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBe(
      requiredElement(container, ".modal-title").id,
    );
    expect(document.activeElement).toBe(input);
    await press(input, "Tab", { shiftKey: true });
    expect(document.activeElement).toBe(last);
    await press(last, "Tab");
    expect(document.activeElement).toBe(input);

    await act(async () => root.render(null));
    expect(document.activeElement).toBe(opener);
  });
});

describe("ConfirmDialog", () => {
  it("labels its content, traps focus, and restores its opener", async () => {
    const opener = pageButton("opener");
    opener.focus();
    const { container, root } = await render(
      <ConfirmDialog
        title="Delete pane?"
        message="This cannot be undone."
        confirmLabel="Delete"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const dialog = requiredElement<HTMLDivElement>(container, '[role="dialog"]');
    const actions = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button"));

    expect(dialog.getAttribute("aria-labelledby")).toBe(
      requiredElement(container, ".modal-title").id,
    );
    expect(dialog.getAttribute("aria-describedby")).toBe(
      requiredElement(container, ".modal-message").id,
    );
    expect(document.activeElement).toBe(dialog);
    await press(dialog, "Tab");
    expect(document.activeElement).toBe(actions[0]);
    await press(actions[0], "Tab", { shiftKey: true });
    expect(document.activeElement).toBe(actions.at(-1));
    await press(actions.at(-1) ?? actions[0], "Tab");
    expect(document.activeElement).toBe(actions[0]);

    await act(async () => root.render(null));
    expect(document.activeElement).toBe(opener);
  });
});

const menuItems = [
  { key: "rename", label: "Rename" },
  { key: "duplicate", label: "Duplicate" },
  { key: "delete", label: "Delete", danger: true },
];

function MenuHarness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true);
  if (!open) {
    return null;
  }
  return (
    <ActionMenu
      x={20}
      y={30}
      items={menuItems}
      onPick={vi.fn()}
      onClose={() => {
        onClose();
        setOpen(false);
      }}
    />
  );
}

function PointerMenuHarness() {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const press = useLongPress((x, y) => setPosition({ x, y }));
  return (
    <>
      <button type="button" data-menu-trigger="true" {...press}>
        Open actions
      </button>
      {position ? (
        <ActionMenu
          x={position.x}
          y={position.y}
          items={menuItems}
          onPick={vi.fn()}
          onClose={() => setPosition(null)}
        />
      ) : null}
    </>
  );
}

function CustomMenuTriggerHarness() {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const open = (x: number, y: number) => setPosition({ x, y });
  const press = useLongPress(open, open);
  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-haspopup="menu"
        aria-expanded={position ? "true" : "false"}
        data-custom-menu-trigger="true"
        {...press}
      >
        Open actions
      </div>
      {position ? (
        <ActionMenu
          x={position.x}
          y={position.y}
          items={menuItems}
          onPick={vi.fn()}
          onClose={() => setPosition(null)}
        />
      ) : null}
    </>
  );
}

async function render(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(node));
  return { container, root };
}

function pageButton(label: string) {
  const button = document.createElement("button");
  button.textContent = label;
  document.body.appendChild(button);
  return button;
}

async function press(target: HTMLElement, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    ...init,
    key,
    bubbles: true,
    cancelable: true,
  });
  await act(async () => target.dispatchEvent(event));
  return event;
}

function requiredElement<T extends Element = HTMLElement>(container: ParentNode, selector: string) {
  const element = container.querySelector<T>(selector);
  if (!element) {
    throw new Error(`missing element: ${selector}`);
  }
  return element;
}
