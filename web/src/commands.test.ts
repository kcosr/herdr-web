import { afterEach, describe, expect, it, vi } from "vitest";
import {
  commands,
  createCommands,
  createdPaneId,
} from "./commands";

describe("command helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("finds created pane ids from supported response shapes", () => {
    expect(createdPaneId({ pane_id: "top" })).toBe("top");
    expect(createdPaneId({ root_pane: { pane_id: "root" } })).toBe("root");
    expect(createdPaneId({ pane: { pane_id: "pane" } })).toBe("pane");
    expect(createdPaneId({ agent: { pane_id: "agent" } })).toBe("agent");
    expect(createdPaneId({ move_result: { pane: { pane_id: "moved" } } })).toBe("moved");
    expect(createdPaneId({})).toBeNull();
  });

  it("uses injected bridge URLs for commands", async () => {
    const httpUrl = (path: string) => `http://192.168.1.20:4000${path}`;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ type: "ok" }), {
        status: 200,
      }),
    );

    await createCommands(httpUrl).closePane("pane-1");

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://192.168.1.20:4000/api/command",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("clears workspace and tab names with null labels", async () => {
    const requests: unknown[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ type: "ok" }), { status: 200 });
    });

    await commands.renameWorkspace("space-1", null);
    await commands.renameTab("tab-1", null);

    expect(requests).toEqual([
      { method: "workspace.rename", params: { workspace_id: "space-1", label: null } },
      { method: "tab.rename", params: { tab_id: "tab-1", label: null } },
    ]);
  });

  it("moves workspace blocks through the atomic Herdr command", async () => {
    const requests: unknown[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ type: "ok" }), { status: 200 });
    });

    await commands.moveWorkspaceBlock(["space-root", "space-child"], "space-before");

    expect(requests).toEqual([
      {
        method: "workspace.move_block",
        params: {
          workspace_ids: ["space-root", "space-child"],
          before_workspace_id: "space-before",
        },
      },
    ]);
  });

  it("launches presets through the bridge-owned launch endpoint", async () => {
    const requests: unknown[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      requests.push({ input, body: JSON.parse(String(init?.body)) });
      return new Response(
        JSON.stringify({
          preset_id: "remote-codex",
          title: "Remote Codex",
          workspace_id: "space-1",
          tab_id: "tab-1",
          pane_id: "pane-1",
        }),
        { status: 200 },
      );
    });

    await commands.launchPresetSplit("pane-0", "tab-0", "right", {
      presetId: "remote-codex",
      label: "Remote Codex",
      title: "Remote Codex",
    });

    expect(requests).toEqual([
      {
        input: "/api/launcher-presets/launch",
        body: {
          preset_id: "remote-codex",
          title: "Remote Codex",
          target: {
            mode: "split",
            target_pane_id: "pane-0",
            tab_id: "tab-0",
            direction: "right",
          },
        },
      },
    ]);
  });

  it("launches preset tabs through the bridge-owned launch endpoint", async () => {
    const requests: unknown[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      requests.push({ input, body: JSON.parse(String(init?.body)) });
      return new Response(
        JSON.stringify({
          preset_id: "builtin:shell",
          title: "Review",
          workspace_id: "space-1",
          tab_id: "tab-1",
          pane_id: "pane-1",
        }),
        { status: 200 },
      );
    });

    await commands.launchPresetTab("space-1", {
      presetId: "builtin:shell",
      label: "Shell",
      title: "Review",
    });

    expect(requests).toEqual([
      {
        input: "/api/launcher-presets/launch",
        body: {
          preset_id: "builtin:shell",
          title: "Review",
          target: { mode: "tab", workspace_id: "space-1" },
        },
      },
    ]);
  });
});
