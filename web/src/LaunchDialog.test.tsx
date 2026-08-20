/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LaunchDialog } from "./LaunchDialog";
import type { LauncherPresetOption } from "./launcherPresets";

const roots: Root[] = [];

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount();
    }
  });
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("LaunchDialog", () => {
  it("renders dynamic launcher presets and submits the selected preset", async () => {
    const { container, onSubmit } = await renderDialog([
      preset("builtin:shell", "Shell", null, true),
      preset("builtin:codex", "Codex", "codex", true),
      preset("remote-codex", "Remote Codex", "codex", false),
      preset("team-agent", "Team Agent", null, false),
    ]);

    const options = launchOptions(container);
    expect(options.map((option) => option.textContent)).toEqual([
      "Shell",
      "Codex",
      "Remote Codex",
      "Team Agent",
    ]);

    await act(async () => {
      options[2].click();
    });
    expect(titleInput(container).value).toBe("Remote Codex");

    await act(async () => {
      createButton(container).click();
    });
    expect(onSubmit).toHaveBeenCalledWith({
      presetId: "remote-codex",
      label: "Remote Codex",
      title: "Remote Codex",
    });
  });

  it("wraps keyboard navigation and scrolls the focused option into view", async () => {
    const { container } = await renderDialog([
      preset("builtin:shell", "Shell", null, true),
      preset("builtin:codex", "Codex", "codex", true),
      preset("remote-codex", "Remote Codex", "codex", false),
      preset("team-agent", "Team Agent", null, false),
    ]);
    const scrollIntoView = window.HTMLElement.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    const options = launchOptions(container);

    await act(async () => {
      options[0].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    });
    expect(options[3].getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(options[3]);
    expect(scrollIntoView).toHaveBeenCalled();

    await act(async () => {
      options[3].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(options[0].getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(options[0]);
  });

  it("disables create and shows an empty message when there are no options", async () => {
    const { container } = await renderDialog([], "Loading launchers…");

    expect(launchOptions(container)).toHaveLength(0);
    expect(container.querySelector(".launch-empty")?.textContent).toBe("Loading launchers…");
    expect(createButton(container).disabled).toBe(true);
  });

  it("selects and titles the first preset when an initially empty list loads", async () => {
    const { container, onSubmit, root } = await renderDialog([], "Loading launchers…");

    await act(async () => {
      root.render(
        <LaunchDialog
          target={{ mode: "tab", workspaceId: "space-1" }}
          options={[preset("builtin:codex", "Codex", "codex", true)]}
          onCancel={vi.fn()}
          onSubmit={onSubmit}
        />,
      );
    });

    expect(launchOptions(container)[0].getAttribute("aria-checked")).toBe("true");
    expect(titleInput(container).value).toBe("Codex");
    expect(createButton(container).disabled).toBe(false);

    await act(async () => {
      createButton(container).click();
    });
    expect(onSubmit).toHaveBeenCalledWith({
      presetId: "builtin:codex",
      label: "Codex",
      title: "Codex",
    });
  });

  it("reselects the first option when the current preset disappears from the list", async () => {
    const { container, root } = await renderDialog([
      preset("builtin:shell", "Shell", null, true),
      preset("builtin:codex", "Codex", "codex", true),
    ]);

    await act(async () => {
      launchOptions(container)[1].click();
    });
    expect(titleInput(container).value).toBe("Codex");
    expect(launchOptions(container)[1].getAttribute("aria-checked")).toBe("true");

    await act(async () => {
      root.render(
        <LaunchDialog
          target={{ mode: "tab", workspaceId: "space-1" }}
          options={[
            preset("builtin:grok", "Grok", "grok", true),
            preset("builtin:opencode", "OpenCode", "opencode", true),
          ]}
          onCancel={vi.fn()}
          onSubmit={vi.fn()}
        />,
      );
    });

    const options = launchOptions(container);
    expect(options.map((option) => option.textContent)).toEqual(["Grok", "OpenCode"]);
    expect(options[0].getAttribute("aria-checked")).toBe("true");
    expect(titleInput(container).value).toBe("Grok");
  });

  it("preserves a custom title when options change", async () => {
    const { container, root } = await renderDialog([
      preset("builtin:shell", "Shell", null, true),
      preset("builtin:codex", "Codex", "codex", true),
    ]);

    await act(async () => {
      const input = titleInput(container);
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "reviewer");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(titleInput(container).value).toBe("reviewer");

    await act(async () => {
      root.render(
        <LaunchDialog
          target={{ mode: "tab", workspaceId: "space-1" }}
          options={[
            preset("builtin:grok", "Grok", "grok", true),
            preset("builtin:opencode", "OpenCode", "opencode", true),
          ]}
          onCancel={vi.fn()}
          onSubmit={vi.fn()}
        />,
      );
    });

    expect(titleInput(container).value).toBe("reviewer");
    expect(launchOptions(container)[0].getAttribute("aria-checked")).toBe("true");
  });

  it("contains modal focus and restores the opener", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { container, root } = await renderDialog([
      preset("builtin:shell", "Shell", null, true),
    ]);
    const dialog = requiredElement<HTMLFormElement>(container, '[role="dialog"]');
    const option = launchOptions(container)[0];
    const create = createButton(container);

    expect(dialog.getAttribute("aria-labelledby")).toBe(
      requiredElement(container, ".modal-title").id,
    );
    expect(requiredElement<HTMLButtonElement>(container, ".overlay-scrim").tabIndex).toBe(-1);
    create.focus();
    await press(create, "Tab");
    expect(document.activeElement).toBe(option);
    await press(option, "Tab", { shiftKey: true });
    expect(document.activeElement).toBe(create);

    await act(async () => root.render(null));
    expect(document.activeElement).toBe(opener);
  });
});

async function renderDialog(options: LauncherPresetOption[], emptyMessage?: string) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  const onSubmit = vi.fn();

  await act(async () => {
    root.render(
      <LaunchDialog
        target={{ mode: "tab", workspaceId: "space-1" }}
        options={options}
        emptyMessage={emptyMessage}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
  });

  return { container, onSubmit, root };
}

function launchOptions(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>(".launch-option"));
}

function titleInput(container: HTMLElement) {
  const input = container.querySelector<HTMLInputElement>("input.field");
  if (!input) {
    throw new Error("missing launch title input");
  }
  return input;
}

function createButton(container: HTMLElement) {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => candidate.textContent === "Create",
  );
  if (!button) {
    throw new Error("missing create button");
  }
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

function preset(
  id: string,
  label: string,
  agentHint: string | null,
  builtIn: boolean,
): LauncherPresetOption {
  return {
    id,
    label,
    agent_hint: agentHint,
    built_in: builtIn,
  };
}
