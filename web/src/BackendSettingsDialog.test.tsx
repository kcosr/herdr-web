/**
 * @vitest-environment jsdom
 */
import { act, useState } from "react";
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

describe("BackendSettingsDialog terminal accessibility", () => {
  it("exposes a persisted-style opt-in control in the Terminal area", async () => {
    const onChange = vi.fn();
    const { container } = await render(<SettingsHarness onChange={onChange} />);
    const terminalTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ).find((button) => button.textContent?.includes("Terminal"));
    if (!terminalTab) {
      throw new Error("missing Terminal settings tab");
    }

    await act(async () => terminalTab.click());
    const group = requiredElement<HTMLElement>(
      container,
      '[role="group"][aria-label="Terminal screen-reader text"]',
    );
    const [off, on] = Array.from(group.querySelectorAll<HTMLButtonElement>("button"));
    expect(off?.getAttribute("aria-pressed")).toBe("true");
    expect(on?.getAttribute("aria-pressed")).toBe("false");

    await act(async () => on?.click());
    expect(onChange).toHaveBeenCalledWith(true);
    expect(off?.getAttribute("aria-pressed")).toBe("false");
    expect(on?.getAttribute("aria-pressed")).toBe("true");
  });

  it("allows automatic conflict renaming to be disabled in the Terminal area", async () => {
    const onChange = vi.fn();
    const { container } = await render(<UploadSettingsHarness onChange={onChange} />);
    const terminalTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ).find((button) => button.textContent?.includes("Terminal"));
    if (!terminalTab) {
      throw new Error("missing Terminal settings tab");
    }

    await act(async () => terminalTab.click());
    const group = requiredElement<HTMLElement>(
      container,
      '[role="group"][aria-label="Automatically rename conflicting uploads"]',
    );
    const [off, on] = Array.from(group.querySelectorAll<HTMLButtonElement>("button"));
    expect(off?.getAttribute("aria-pressed")).toBe("false");
    expect(on?.getAttribute("aria-pressed")).toBe("true");

    await act(async () => off?.click());
    expect(onChange).toHaveBeenCalledWith(false);
    expect(off?.getAttribute("aria-pressed")).toBe("true");
    expect(on?.getAttribute("aria-pressed")).toBe("false");
  });

  it("offers desktop command composer settings in the Terminal area", async () => {
    const onComposerChange = vi.fn();
    const onEnterNewlineChange = vi.fn();
    const { container } = await render(
      <ComposerSettingsHarness
        onComposerChange={onComposerChange}
        onEnterNewlineChange={onEnterNewlineChange}
      />,
    );
    const terminalTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ).find((button) => button.textContent?.includes("Terminal"));
    if (!terminalTab) {
      throw new Error("missing Terminal settings tab");
    }

    await act(async () => terminalTab.click());
    const composerGroup = requiredElement<HTMLElement>(
      container,
      '[role="group"][aria-label="Command composer"]',
    );
    const [composerOff, composerOn] = Array.from(
      composerGroup.querySelectorAll<HTMLButtonElement>("button"),
    );
    expect(composerOff?.getAttribute("aria-pressed")).toBe("true");

    await act(async () => composerOn?.click());
    expect(onComposerChange).toHaveBeenCalledWith(true);
    expect(composerOn?.getAttribute("aria-pressed")).toBe("true");

    const newlineGroup = requiredElement<HTMLElement>(
      container,
      '[role="group"][aria-label="Desktop composer Enter inserts newline"]',
    );
    const [newlineOff, newlineOn] = Array.from(
      newlineGroup.querySelectorAll<HTMLButtonElement>("button"),
    );
    expect(newlineOn?.getAttribute("aria-pressed")).toBe("true");

    await act(async () => newlineOff?.click());
    expect(onEnterNewlineChange).toHaveBeenCalledWith(false);
    expect(newlineOff?.getAttribute("aria-pressed")).toBe("true");
  });
});

function SettingsHarness({ onChange }: { onChange: (enabled: boolean) => void }) {
  const [terminalScreenReaderText, setTerminalScreenReaderText] = useState(false);
  return (
    <BackendSettingsDialog
      {...settingsProps()}
      terminalScreenReaderText={terminalScreenReaderText}
      onTerminalScreenReaderText={(enabled) => {
        onChange(enabled);
        setTerminalScreenReaderText(enabled);
      }}
    />
  );
}

function UploadSettingsHarness({ onChange }: { onChange: (enabled: boolean) => void }) {
  const [autoRenameUploadConflicts, setAutoRenameUploadConflicts] = useState(true);
  return (
    <BackendSettingsDialog
      {...settingsProps()}
      autoRenameUploadConflicts={autoRenameUploadConflicts}
      onAutoRenameUploadConflicts={(enabled) => {
        onChange(enabled);
        setAutoRenameUploadConflicts(enabled);
      }}
    />
  );
}

function ComposerSettingsHarness({
  onComposerChange,
  onEnterNewlineChange,
}: {
  onComposerChange: (enabled: boolean) => void;
  onEnterNewlineChange: (enabled: boolean) => void;
}) {
  const [desktopCommandComposer, setDesktopCommandComposer] = useState(false);
  const [desktopCommandEnterNewline, setDesktopCommandEnterNewline] = useState(true);
  return (
    <BackendSettingsDialog
      {...settingsProps()}
      showMobileTerminalSettings={false}
      desktopCommandComposer={desktopCommandComposer}
      onDesktopCommandComposer={(enabled) => {
        onComposerChange(enabled);
        setDesktopCommandComposer(enabled);
      }}
      desktopCommandEnterNewline={desktopCommandEnterNewline}
      onDesktopCommandEnterNewline={(enabled) => {
        onEnterNewlineChange(enabled);
        setDesktopCommandEnterNewline(enabled);
      }}
    />
  );
}

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
    desktopCommandComposer: false,
    onDesktopCommandComposer: vi.fn(),
    desktopCommandEnterNewline: true,
    onDesktopCommandEnterNewline: vi.fn(),
    terminalScreenReaderText: false,
    onTerminalScreenReaderText: vi.fn(),
    autoRenameUploadConflicts: true,
    onAutoRenameUploadConflicts: vi.fn(),
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

async function render(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(node));
  return { container, root };
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
