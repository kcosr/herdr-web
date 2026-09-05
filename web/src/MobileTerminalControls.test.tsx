/**
 * @vitest-environment jsdom
 */
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isCommandComposerSubmitShortcut,
  TerminalCommandControls,
} from "./TerminalView";

const roots: Root[] = [];

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
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

describe("TerminalCommandControls", () => {
  for (const expandingInput of [false, true]) {
    it(`clears and remounts the ${
      expandingInput ? "textarea" : "input"
    } after Send`, async () => {
      const { commandInputRef, container, onSubmitCommand } =
        await renderControls(expandingInput);
      const firstField = commandField(container);

      await setCommandValue(firstField, "first prompt");
      firstField.defaultValue = "first prompt";
      firstField.focus();
      await submitForm(container);

      expect(onSubmitCommand).toHaveBeenLastCalledWith("first prompt");
      expect(firstField.value).toBe("");
      expect(firstField.defaultValue).toBe("");

      const secondField = commandField(container);
      expect(secondField).not.toBe(firstField);
      expect(secondField.value).toBe("");
      expect(secondField.defaultValue).toBe("");
      expect(commandInputRef.current).toBe(secondField);
      expect(document.activeElement).not.toBe(secondField);

      await setCommandValue(secondField, "second prompt");
      expect(secondField.value).toBe("second prompt");
      await submitForm(container);

      expect(onSubmitCommand).toHaveBeenLastCalledWith("second prompt");
      expect(onSubmitCommand).toHaveBeenCalledTimes(2);
    });
  }

  it("clears and remounts after Stage while keeping empty Stage disabled", async () => {
    const { container, onStageCommand } = await renderControls(false);
    const firstField = commandField(container);

    await setCommandValue(firstField, "staged prompt");
    firstField.defaultValue = "staged prompt";
    await clickStage(container);

    expect(onStageCommand).toHaveBeenCalledOnce();
    expect(onStageCommand).toHaveBeenCalledWith("staged prompt");
    expect(firstField.value).toBe("");
    expect(firstField.defaultValue).toBe("");

    const secondField = commandField(container);
    expect(secondField).not.toBe(firstField);
    expect(secondField.value).toBe("");
    expect(secondField.defaultValue).toBe("");
    expect(stageButton(container).disabled).toBe(true);

    await clickStage(container);
    expect(onStageCommand).toHaveBeenCalledOnce();
  });

  it("continues submitting an empty command as Enter", async () => {
    const { container, onSubmitCommand } = await renderControls(false);

    await submitForm(container);

    expect(onSubmitCommand).toHaveBeenCalledWith("");
  });

  it("keeps multiline paste as one editable value until Send", async () => {
    const { container, onSubmitCommand } = await renderControls(true, {
      enterNewline: true,
      mobileControls: false,
    });
    const field = commandField(container);

    await setCommandValue(field, "first line\nsecond line");

    expect(onSubmitCommand).not.toHaveBeenCalled();
    expect(field.value).toBe("first line\nsecond line");
    await submitForm(container);
    expect(onSubmitCommand).toHaveBeenCalledWith("first line\nsecond line");
  });

  it("renders the composer without mobile terminal keys in desktop mode", async () => {
    const { container } = await renderControls(true, { mobileControls: false });

    expect(commandField(container)).toBeInstanceOf(HTMLTextAreaElement);
    expect(container.querySelector<HTMLElement>(".term-key-strip")?.hidden).toBe(true);
    expect(container.querySelector(".term-input-row")).not.toBeNull();
  });

  it("inserts Enter and submits Ctrl+Enter in a Linux desktop composer", async () => {
    vi.spyOn(window.navigator, "platform", "get").mockReturnValue("Linux x86_64");
    const { container, onSubmitCommand } = await renderControls(true, {
      enterNewline: true,
      mobileControls: false,
    });
    const field = commandField(container);
    await setCommandValue(field, "two\nlines");

    const enter = await keyDown(field, { key: "Enter" });
    expect(enter.defaultPrevented).toBe(false);
    expect(onSubmitCommand).not.toHaveBeenCalled();

    const submit = await keyDown(field, { key: "Enter", ctrlKey: true });
    expect(submit.defaultPrevented).toBe(true);
    expect(onSubmitCommand).toHaveBeenCalledWith("two\nlines");
  });

  it("uses Cmd+Enter, not Ctrl+Enter, as the macOS submit shortcut", () => {
    expect(
      isCommandComposerSubmitShortcut(
        { key: "Enter", altKey: false, ctrlKey: false, metaKey: true, shiftKey: false },
        "MacIntel",
      ),
    ).toBe(true);
    expect(
      isCommandComposerSubmitShortcut(
        { key: "Enter", altKey: false, ctrlKey: true, metaKey: false, shiftKey: false },
        "MacIntel",
      ),
    ).toBe(false);
  });

  it("keeps the existing mobile multiline modifier behavior", async () => {
    const { container, onSubmitCommand } = await renderControls(true, {
      enterNewline: true,
      mobileControls: true,
    });
    const event = await keyDown(commandField(container), { key: "Enter", ctrlKey: true });

    expect(event.defaultPrevented).toBe(false);
    expect(onSubmitCommand).not.toHaveBeenCalled();
  });
});

async function renderControls(
  expandingInput: boolean,
  options: { enterNewline?: boolean; mobileControls?: boolean } = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  const commandInputRef = createRef<HTMLInputElement | HTMLTextAreaElement>();
  const onSubmitCommand = vi.fn();
  const onStageCommand = vi.fn();

  await act(async () => {
    root.render(
      <TerminalCommandControls
        commandInputRef={commandInputRef}
        disabled={false}
        uploadDisabled={false}
        expandingInput={expandingInput}
        enterNewline={options.enterNewline ?? false}
        mobileControls={options.mobileControls ?? true}
        controlsScalePercent={100}
        onControlsHeightChange={vi.fn()}
        onInput={vi.fn()}
        onTerminalFocus={vi.fn()}
        onUpload={vi.fn()}
        onStageCommand={onStageCommand}
        onSubmitCommand={onSubmitCommand}
      />,
    );
  });

  return {
    commandInputRef,
    container,
    onStageCommand,
    onSubmitCommand,
  };
}

async function keyDown(
  field: HTMLInputElement | HTMLTextAreaElement,
  init: KeyboardEventInit,
) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  await act(async () => {
    field.dispatchEvent(event);
  });
  return event;
}

function commandField(container: HTMLElement) {
  const field = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    ".term-native-input",
  );
  if (!field) {
    throw new Error("missing mobile command field");
  }
  return field;
}

async function setCommandValue(
  field: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  await act(async () => {
    const prototype =
      field instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submitForm(container: HTMLElement) {
  const form = container.querySelector("form");
  if (!form) {
    throw new Error("missing mobile command form");
  }
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

function stageButton(container: HTMLElement) {
  const button = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Stage command in terminal"]',
  );
  if (!button) {
    throw new Error("missing Stage button");
  }
  return button;
}

async function clickStage(container: HTMLElement) {
  await act(async () => {
    stageButton(container).click();
  });
}
