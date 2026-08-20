/**
 * @vitest-environment jsdom
 */
import { act, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BridgeConnectionController,
  NoteEditor,
  QuickPaneNoteDialog,
  noteDraftStorageKey,
} from "./App";
import type { BridgeConnectionRef, BridgeConnectionState, ScopedNoteEntry } from "./App";
import type { BridgeRuntime } from "./bridge";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

const roots: Root[] = [];

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  FakeWebSocket.instances = [];
  vi.useFakeTimers();
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount();
    }
  });
  document.body.innerHTML = "";
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BridgeConnectionController sockets", () => {
  it("does not recreate event sockets when only the notes callback identity changes", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(emptySnapshot()), { status: 200 })),
    );
    const connectionRefs = { current: {} } as MutableRefObject<Record<string, BridgeConnectionRef>>;
    const setConnectionStates = vi.fn() as unknown as Dispatch<
      SetStateAction<Record<string, BridgeConnectionState>>
    >;
    const runtime = bridgeRuntime("bridge-a");
    const { render } = createConnectionHarness({
      runtime,
      connectionRefs,
      setConnectionStates,
    });

    await render(vi.fn());

    expect(FakeWebSocket.instances.map((socket) => socket.url)).toEqual([
      "ws://bridge-a/ws/events",
      "ws://bridge-a/ws/activity",
      "ws://bridge-a/ws/ui-events",
    ]);

    await render(vi.fn());

    expect(FakeWebSocket.instances).toHaveLength(3);
    expect(FakeWebSocket.instances.filter((socket) => socket.closed)).toHaveLength(0);
  });

  it("stops applying shared selection events without recreating event sockets", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    let sharedPaneId: string | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ...emptySnapshot(),
            selected_pane_id: sharedPaneId,
          }),
          { status: 200 },
        ),
      ),
    );
    const connectionRefs = { current: {} } as MutableRefObject<Record<string, BridgeConnectionRef>>;
    const setConnectionStates = vi.fn() as unknown as Dispatch<
      SetStateAction<Record<string, BridgeConnectionState>>
    >;
    const { render, onPaneSelection } = createConnectionHarness({
      runtime: bridgeRuntime("bridge-a"),
      connectionRefs,
      setConnectionStates,
    });

    await render(vi.fn(), true);
    const uiEvents = FakeWebSocket.instances.find(
      (socket) => socket.url === "ws://bridge-a/ws/ui-events",
    );
    if (!uiEvents) {
      throw new Error("missing UI events socket");
    }
    sharedPaneId = "pane-a";
    await act(async () => {
      uiEvents.dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "herdr_web.selection_changed", pane_id: "pane-a" }),
        }),
      );
      await Promise.resolve();
    });
    expect(onPaneSelection).toHaveBeenCalledTimes(1);

    await render(vi.fn(), false);
    sharedPaneId = "pane-b";
    await act(async () => {
      uiEvents.dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "herdr_web.selection_changed", pane_id: "pane-b" }),
        }),
      );
      await Promise.resolve();
    });

    expect(onPaneSelection).toHaveBeenCalledTimes(1);
    expect(connectionRefs.current["bridge-a"]?.snapshot?.selected_pane_id).toBe("pane-b");
    expect(FakeWebSocket.instances).toHaveLength(3);
    expect(FakeWebSocket.instances.filter((socket) => socket.closed)).toHaveLength(0);
  });
});

describe("QuickPaneNoteDialog", () => {
  it("selects the title and submits an optional body", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    const onSubmit = vi.fn();

    await act(async () => {
      root.render(
        <QuickPaneNoteDialog
          targetLabel="Pinned Indicator"
          onCancel={vi.fn()}
          onSubmit={onSubmit}
        />,
      );
    });

    const titleInput = container.querySelector<HTMLInputElement>("input.field");
    if (!titleInput) {
      throw new Error("missing quick note title input");
    }
    expect(document.activeElement).toBe(titleInput);
    expect(container.querySelector<HTMLButtonElement>(".overlay-scrim")?.tabIndex).toBe(-1);
    expect(titleInput.selectionStart).toBe(0);
    expect(titleInput.selectionEnd).toBe(titleInput.value.length);
    const createButton = buttonByText(container, "Create");

    await act(async () => {
      createButton.click();
    });
    expect(onSubmit).toHaveBeenLastCalledWith("Untitled note", "");

    await act(async () => {
      buttonByText(container, "Add body").click();
    });
    const bodyInput = container.querySelector<HTMLTextAreaElement>(".quick-note-body");
    if (!bodyInput) {
      throw new Error("missing quick note body input");
    }
    expect(document.activeElement).toBe(bodyInput);
    await act(async () => {
      setNativeValue(bodyInput, "Follow-up details");
      bodyInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      buttonByText(container, "Create").click();
    });
    expect(onSubmit).toHaveBeenLastCalledWith("Untitled note", "Follow-up details");

    await act(async () => root.render(null));
    expect(document.activeElement).toBe(opener);
  });
});

describe("NoteEditor autosave conflicts", () => {
  it("keeps continued typing pending when the user's in-flight save appears in a refetch", async () => {
    const saves: Array<{
      title: string;
      body: string;
      expectedRevision: number;
      deferred: Deferred<number>;
    }> = [];
    const onSave = vi.fn((_entry: ScopedNoteEntry, title: string, body: string, expectedRevision: number) => {
      const deferred = createDeferred<number>();
      saves.push({ title, body, expectedRevision, deferred });
      return deferred.promise;
    });
    const { container, render } = createEditorHarness(onSave);

    await render(noteEntry({ revision: 5, body: "" }));
    await changeTextarea(container, "abc");
    await advanceAutosaveTimer();

    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({ body: "abc", expectedRevision: 5 });

    await changeTextarea(container, "abcd");
    await render(noteEntry({ revision: 6, body: "abc" }));

    expect(editorStatus(container)).not.toBe("conflict");
    expect(noteBodyInput(container).value).toBe("abcd");

    await act(async () => {
      saves[0].deferred.resolve(6);
      await Promise.resolve();
    });
    await advanceAutosaveTimer();

    expect(editorStatus(container)).not.toBe("conflict");
    expect(saves).toHaveLength(2);
    expect(saves[1]).toMatchObject({ body: "abcd", expectedRevision: 6 });
  });

  it("does not flag stale server props as a conflict after a local save resolves", async () => {
    const saves: Array<{
      body: string;
      expectedRevision: number;
      deferred: Deferred<number>;
    }> = [];
    const onSave = vi.fn((_entry: ScopedNoteEntry, _title: string, body: string, expectedRevision: number) => {
      const deferred = createDeferred<number>();
      saves.push({ body, expectedRevision, deferred });
      return deferred.promise;
    });
    const { container, render } = createEditorHarness(onSave);

    await render(noteEntry({ revision: 5, body: "" }));
    await changeTextarea(container, "abc");
    await advanceAutosaveTimer();

    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({ body: "abc", expectedRevision: 5 });

    await act(async () => {
      saves[0].deferred.resolve(6);
      await Promise.resolve();
      await Promise.resolve();
    });
    await changeTextarea(container, "abcd");
    await advanceAutosaveTimer();

    expect(editorStatus(container)).not.toBe("conflict");
    expect(noteBodyInput(container).value).toBe("abcd");
    expect(saves).toHaveLength(2);
    expect(saves[1]).toMatchObject({ body: "abcd", expectedRevision: 6 });
  });

  it("enters conflict when a divergent server revision arrives under a dirty draft", async () => {
    const saves: Array<{ body: string; expectedRevision: number; deferred: Deferred<number> }> = [];
    const onSave = vi.fn((_entry: ScopedNoteEntry, _title: string, body: string, expectedRevision: number) => {
      const deferred = createDeferred<number>();
      saves.push({ body, expectedRevision, deferred });
      return deferred.promise;
    });
    const { container, render } = createEditorHarness(onSave);

    await render(noteEntry({ revision: 5, body: "" }));
    await changeTextarea(container, "local draft");
    await advanceAutosaveTimer();
    await render(noteEntry({ revision: 6, body: "remote edit" }));

    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({ body: "local draft", expectedRevision: 5 });
    expect(editorStatus(container)).toBe("conflict");
    expect(noteBodyInput(container).value).toBe("local draft");
  });

  it("does not starve autosave when parent renders replace entry and save callback identities", async () => {
    const saves: Array<{ body: string; expectedRevision: number }> = [];
    const saveFactory = () =>
      vi.fn((_entry: ScopedNoteEntry, _title: string, body: string, expectedRevision: number) => {
        saves.push({ body, expectedRevision });
        return Promise.resolve(6);
      });
    const { container, render } = createEditorHarness(saveFactory());

    await render(noteEntry({ revision: 5, body: "" }));
    await changeTextarea(container, "local draft");

    for (let index = 0; index < 3; index += 1) {
      await act(async () => {
        vi.advanceTimersByTime(200);
      });
      await render(noteEntry({ revision: 5, body: "" }), { onSave: saveFactory() });
    }
    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });

    expect(saves).toEqual([{ body: "local draft", expectedRevision: 5 }]);
  });

  it("reloads persisted dirty drafts as conflict only when the server revision advanced", async () => {
    const onSave = vi.fn(() => Promise.resolve(7));
    const { container, render } = createEditorHarness(onSave);
    const advancedEntry = noteEntry({ revision: 6, body: "remote edit" });

    localStorage.setItem(
      noteDraftStorageKey(advancedEntry),
      JSON.stringify({
        title: "Local title",
        body: "local draft",
        baseRevision: 5,
        updatedAt: 100,
      }),
    );
    await render(advancedEntry);

    expect(editorStatus(container)).toBe("conflict");
    expect(noteBodyInput(container).value).toBe("local draft");

    const matchingBaseEntry = noteEntry({ noteId: "note-2", revision: 6, body: "remote edit" });
    localStorage.setItem(
      noteDraftStorageKey(matchingBaseEntry),
      JSON.stringify({
        title: "Local title",
        body: "local draft",
        baseRevision: 6,
        updatedAt: 200,
      }),
    );
    await render(matchingBaseEntry);

    expect(editorStatus(container)).toBe("");
    expect(noteBodyInput(container).value).toBe("local draft");
  });
});

describe("NoteEditor actions", () => {
  it("renders markdown preview and persists the selected editor mode", async () => {
    const onSave = vi.fn(() => Promise.resolve(6));
    const { container, render } = createEditorHarness(onSave);

    await render(noteEntry({ revision: 5, body: "# Heading\n\n- item" }));
    await act(async () => {
      buttonByText(container, "Preview").click();
      await vi.dynamicImportSettled();
    });

    expect(container.querySelector(".note-body-input")).toBeNull();
    expect(container.querySelector(".note-body-preview h1")?.textContent).toBe("Heading");
    expect(container.querySelector(".note-body-preview li")?.textContent).toBe("item");
    expect(localStorage.getItem("herdr-web:note-editor-mode:v1")).toBe("preview");

    await act(async () => {
      buttonByText(container, "Edit").click();
    });

    expect(noteBodyInput(container).value).toBe("# Heading\n\n- item");
    expect(localStorage.getItem("herdr-web:note-editor-mode:v1")).toBe("edit");
  });

  it("restores the persisted markdown preview mode", async () => {
    localStorage.setItem("herdr-web:note-editor-mode:v1", "preview");
    const onSave = vi.fn(() => Promise.resolve(6));
    const { container, render } = createEditorHarness(onSave);

    await render(noteEntry({ revision: 5, body: "**bold**" }));
    await act(async () => {
      await vi.dynamicImportSettled();
    });

    expect(container.querySelector(".note-body-input")).toBeNull();
    expect(container.querySelector(".note-body-preview strong")?.textContent).toBe("bold");
  });

  it("forces edit mode and selects the title for note title focus requests", async () => {
    localStorage.setItem("herdr-web:note-editor-mode:v1", "preview");
    const onSave = vi.fn(() => Promise.resolve(2));
    const { container, render } = createEditorHarness(onSave);

    await render(
      noteEntry({
        noteId: "note-new",
        revision: 1,
        title: "Untitled note",
        body: "",
      }),
      {
        titleFocusRequest: {
          bridgeId: "bridge-a",
          noteId: "note-new",
          token: 1,
        },
      },
    );
    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    const titleInput = noteTitleInput(container);
    expect(noteBodyInput(container).value).toBe("");
    expect(document.activeElement).toBe(titleInput);
    expect(titleInput.selectionStart).toBe(0);
    expect(titleInput.selectionEnd).toBe(titleInput.value.length);
    expect(localStorage.getItem("herdr-web:note-editor-mode:v1")).toBe("edit");
  });

  it("escapes raw HTML, blocks remote images, and restricts markdown links", async () => {
    const onSave = vi.fn(() => Promise.resolve(6));
    const { container, render } = createEditorHarness(onSave);

    await render(
      noteEntry({
        revision: 5,
        body: [
          "<script>alert('x')</script>",
          "![pixel](https://attacker.example/pixel.png)",
          "[web](https://example.com)",
          "[mail](mailto:test@example.com)",
          "[script](javascript:alert(1))",
        ].join("\n\n"),
      }),
    );
    await act(async () => {
      buttonByText(container, "Preview").click();
      await vi.dynamicImportSettled();
    });

    expect(container.querySelector(".note-body-preview script")).toBeNull();
    expect(container.querySelector(".note-body-preview img")).toBeNull();
    const webLink = container.querySelector<HTMLAnchorElement>(
      '.note-body-preview a[href="https://example.com/"]',
    );
    expect(webLink?.target).toBe("_blank");
    expect(webLink?.rel).toContain("noopener");
    expect(webLink?.rel).toContain("noreferrer");
    expect(container.querySelector('.note-body-preview a[href^="mailto:"]')).toBeNull();
    expect(container.querySelector('.note-body-preview a[href^="javascript:"]')).toBeNull();
  });

  it("allows unresolved notes with a matching stale pane id to be reattached", async () => {
    const onSave = vi.fn(() => Promise.resolve(6));
    const { container, render } = createEditorHarness(onSave);

    await render(
      noteEntry({
        revision: 5,
        body: "",
        linkState: "unresolved",
        attachmentPaneId: "pane-a",
      }),
    );

    expect(container.querySelector('[aria-label="Attach to current pane"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="View pane"]')).toBeNull();
  });

  it("can show the current linked pane action for compact full-screen notes", async () => {
    const onSave = vi.fn(() => Promise.resolve(6));
    const { container, render } = createEditorHarness(onSave);
    const currentPaneNote = noteEntry({
      revision: 5,
      body: "",
      linkState: "linked",
      attachmentPaneId: "pane-a",
      resolvedPaneId: "pane-a",
    });

    await render(currentPaneNote);

    expect(container.querySelector('[aria-label="View pane"]')).toBeNull();

    await render(currentPaneNote, { showCurrentPaneViewAction: true });

    expect(container.querySelector('[aria-label="View pane"]')).not.toBeNull();
  });
});

function createEditorHarness(
  onSave: (entry: ScopedNoteEntry, title: string, body: string, expectedRevision: number) => Promise<number>,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);

  const render = async (
    entry: ScopedNoteEntry,
    options: {
      showCurrentPaneViewAction?: boolean;
      titleFocusRequest?: {
        bridgeId: string;
        noteId: string;
        token: number;
      };
      onSave?: (
        entry: ScopedNoteEntry,
        title: string,
        body: string,
        expectedRevision: number,
      ) => Promise<number>;
    } = {},
  ) => {
    await act(async () => {
      root.render(
        <NoteEditor
          entry={entry}
          currentBridgeId="bridge-a"
          currentPaneId="pane-a"
          titleFocusRequest={options.titleFocusRequest}
          canAttachToCurrentPane
          showCurrentPaneViewAction={options.showCurrentPaneViewAction}
          onSave={options.onSave ?? onSave}
          onAttachToCurrentPane={vi.fn()}
          onDetach={vi.fn()}
          onArchive={vi.fn()}
          onRestore={vi.fn()}
          onDelete={vi.fn()}
          onViewPane={vi.fn()}
        />,
      );
    });
  };

  return { container, render };
}

function noteEntry({
  noteId = "note-1",
  revision,
  title = "Server title",
  body,
  linkState = "detached",
  attachmentPaneId,
  resolvedPaneId,
}: {
  noteId?: string;
  revision: number;
  title?: string;
  body: string;
  linkState?: "linked" | "unresolved" | "detached";
  attachmentPaneId?: string;
  resolvedPaneId?: string;
}): ScopedNoteEntry {
  const resolvedPane = resolvedPaneId
    ? {
        pane_id: resolvedPaneId,
        terminal_id: "terminal-a",
        workspace_id: "workspace-a",
        tab_id: "tab-a",
        focused: true,
        agent_status: "idle" as const,
        revision: 1,
      }
    : undefined;
  return {
    bridgeId: "bridge-a",
    connectionKey: "http://bridge-a",
    storeId: "store-a",
    sessionKey: "session-a",
    bridgeSessionKey: "session-a",
    bridgeIndex: 0,
    bridgeLabel: "Bridge A",
    bridgeColor: "#89b4fa",
    snapshot: null,
    note: {
      note_id: noteId,
      title,
      body,
      created_at: "1",
      updated_at: String(revision),
      session_key: "session-a",
      attachment: attachmentPaneId
        ? {
            type: "pane",
            pane_id: attachmentPaneId,
            workspace_id: "workspace-a",
            tab_id: "tab-a",
            captured_at: "1",
            context: {},
          }
        : undefined,
      attachment_history: [],
      revision,
      link_state: linkState,
      resolved_pane: resolvedPane,
    },
    pane: resolvedPane,
  };
}

async function changeTextarea(container: HTMLElement, value: string) {
  const input = noteBodyInput(container);
  await act(async () => {
    setNativeValue(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function advanceAutosaveTimer() {
  await act(async () => {
    vi.advanceTimersByTime(700);
    await Promise.resolve();
  });
}

function editorStatus(container: HTMLElement) {
  return container.querySelector(".note-editor-save-status")?.textContent ?? "";
}

function noteBodyInput(container: HTMLElement) {
  const input = container.querySelector<HTMLTextAreaElement>(".note-body-input");
  if (!input) {
    throw new Error("missing note body input");
  }
  return input;
}

function noteTitleInput(container: HTMLElement) {
  const input = container.querySelector<HTMLInputElement>(".note-title-input");
  if (!input) {
    throw new Error("missing note title input");
  }
  return input;
}

function buttonByText(container: HTMLElement, text: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (item) => item.textContent === text,
  );
  if (!button) {
    throw new Error(`missing button: ${text}`);
  }
  return button;
}

function setNativeValue(element: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(element, value);
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function createConnectionHarness({
  runtime,
  connectionRefs,
  setConnectionStates,
}: {
  runtime: BridgeRuntime;
  connectionRefs: MutableRefObject<Record<string, BridgeConnectionRef>>;
  setConnectionStates: Dispatch<SetStateAction<Record<string, BridgeConnectionState>>>;
}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onPaneSelection = vi.fn();
  roots.push(root);

  const render = async (
    onNotesChanged: (bridgeId: string) => void,
    followSharedSelection = true,
  ) => {
    await act(async () => {
      root.render(
        <BridgeConnectionController
          runtime={runtime}
          followSharedSelection={followSharedSelection}
          connectionRefs={connectionRefs}
          setConnectionStates={setConnectionStates}
          onPaneSelection={onPaneSelection}
          onAgentActivityChanged={() => undefined}
          onAgentPinsChanged={() => undefined}
          onNotesChanged={onNotesChanged}
        />,
      );
      await Promise.resolve();
    });
  };

  return { render, onPaneSelection };
}

function bridgeRuntime(bridgeId: string): BridgeRuntime {
  return {
    id: bridgeId,
    mode: "configured",
    proxied: false,
    label: bridgeId,
    color: "#89b4fa",
    backend: null,
    connectionKey: bridgeId,
    resumeToken: 0,
    capabilities: { commands: [], notes: { version: 1 } },
    capabilityState: "ready",
    capabilityError: null,
    canConnect: true,
    httpUrl: (path) => `http://${bridgeId}${path}`,
    wsUrl: (path) => `ws://${bridgeId}${path}`,
  };
}

function emptySnapshot() {
  return {
    workspaces: [],
    tabs: [],
    panes: [],
    layouts: [],
  };
}

class FakeWebSocket extends EventTarget {
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  closed = false;

  constructor(url: string | URL) {
    super();
    this.url = String(url);
    FakeWebSocket.instances.push(this);
  }

  close() {
    this.closed = true;
    this.dispatchEvent(new CloseEvent("close"));
  }
}
