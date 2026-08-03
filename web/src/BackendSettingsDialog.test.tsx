/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackendSettingsDialog } from "./BackendSettingsDialog";

const bridge = vi.hoisted(() => ({
  store: {
    backends: [],
    enabledBridgeIds: [],
  },
  lastSelectedBridgeId: null,
  sameOriginAvailable: true,
  addBackend: vi.fn(),
  deleteBackend: vi.fn(),
  probeBackend: vi.fn(),
  setBridgeEnabled: vi.fn(),
  updateBackend: vi.fn(),
}));

vi.mock("./bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./bridge")>();
  return {
    ...actual,
    useBridge: () => bridge,
  };
});

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
  vi.clearAllMocks();
});

describe("BackendSettingsDialog accessibility", () => {
  it("contains keyboard focus and restores the opener when it closes", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(<BackendSettingsDialog {...settingsProps()} />);
    });

    const dialog = requiredElement<HTMLFormElement>(container, '[role="dialog"]');
    const close = requiredElement<HTMLButtonElement>(dialog, ".modal-close");
    const scrim = requiredElement<HTMLButtonElement>(container, ".overlay-scrim");
    const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    const last = buttons.at(-1);
    if (!last) {
      throw new Error("missing settings actions");
    }

    expect(document.activeElement).toBe(close);
    expect(scrim.tabIndex).toBe(-1);

    last.focus();
    await press(last, "Tab");
    expect(document.activeElement).toBe(close);
    await press(close, "Tab", { shiftKey: true });
    expect(document.activeElement).toBe(last);

    await act(async () => {
      root.render(null);
    });
    expect(document.activeElement).toBe(opener);
  });
});

function settingsProps() {
  return {
    showMobileTerminalSettings: true,
    notesEnabled: true,
    onNotesEnabled: vi.fn(),
    navigationSyncMode: "shared" as const,
    onNavigationSyncMode: vi.fn(),
    agentFeaturesInTabs: true,
    onAgentFeaturesInTabs: vi.fn(),
    combineMatchingWorkspaceNames: false,
    onCombineMatchingWorkspaceNames: vi.fn(),
    multiHostSpaceSelection: true,
    onMultiHostSpaceSelection: vi.fn(),
    terminalFontSizePx: 13,
    onTerminalFontSizePx: vi.fn(),
    terminalInputTransport: "json" as const,
    onTerminalInputTransport: vi.fn(),
    terminalInputBatchDelayMs: 0,
    onTerminalInputBatchDelayMs: vi.fn(),
    terminalOutputCoalesceMs: 16,
    onTerminalOutputCoalesceMs: vi.fn(),
    contentInsetTopPx: 0,
    onContentInsetTopPx: vi.fn(),
    contentInsetBottomPx: 0,
    onContentInsetBottomPx: vi.fn(),
    mobileControlsScalePercent: 100,
    onMobileControlsScalePercent: vi.fn(),
    mobileTerminalTapTarget: "command-input" as const,
    onMobileTerminalTapTarget: vi.fn(),
    mobileLongPressBehavior: "off" as const,
    onMobileLongPressBehavior: vi.fn(),
    mobileTouchSelectionEndpointTimeoutMs: 1500 as const,
    onMobileTouchSelectionEndpointTimeoutMs: vi.fn(),
    mobileCommandExpandingInput: true,
    onMobileCommandExpandingInput: vi.fn(),
    mobileCommandEnterNewline: false,
    onMobileCommandEnterNewline: vi.fn(),
    showMobileKeyboardHideRefit: true,
    mobileKeyboardHideRefit: true,
    onMobileKeyboardHideRefit: vi.fn(),
    onClose: vi.fn(),
  };
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
