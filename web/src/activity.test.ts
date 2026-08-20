import { describe, expect, it } from "vitest";
import {
  applyActivityMessage,
  parseActivityEventData,
  parseActivityMessage,
  replayActivityMessages,
} from "./activity";
import type { PaneInfo, Snapshot } from "./types";

const pane = (pane_id: string, tab_id = "tab-1", agent_status: PaneInfo["agent_status"] = "idle") =>
  ({
    pane_id,
    terminal_id: `terminal-${pane_id}`,
    workspace_id: "workspace-1",
    tab_id,
    focused: false,
    agent_status,
    revision: 1,
  }) satisfies PaneInfo;

const snapshot = (panes: PaneInfo[]): Snapshot => ({
  workspaces: [
    {
      workspace_id: "workspace-1",
      number: 1,
      label: "repo",
      focused: true,
      pane_count: panes.length,
      tab_count: 1,
      active_tab_id: "tab-1",
      agent_status: "idle",
    },
  ],
  tabs: [
    {
      tab_id: "tab-1",
      workspace_id: "workspace-1",
      number: 1,
      label: "main",
      focused: true,
      pane_count: panes.length,
      agent_status: "idle",
    },
  ],
  panes,
  layouts: [],
});

describe("parseActivityMessage", () => {
  it("parses pane activity messages with explicit null fields", () => {
    expect(
      parseActivityMessage(
        JSON.stringify({
          type: "pane.agent_status_changed",
          pane_id: "pane-1",
          workspace_id: "workspace-1",
          agent_status: "working",
          agent: "codex",
          title: null,
          display_agent: null,
          state_labels: {},
        }),
      ),
    ).toMatchObject({
      type: "pane.agent_status_changed",
      pane_id: "pane-1",
      agent_status: "working",
      title: null,
    });
  });

  it("rejects sparse activity messages so clear semantics stay explicit", () => {
    expect(
      parseActivityMessage(
        JSON.stringify({
          type: "pane.agent_status_changed",
          pane_id: "pane-1",
          workspace_id: "workspace-1",
          agent_status: "working",
        }),
      ),
    ).toBeNull();
    expect(
      parseActivityEventData(
        JSON.stringify({
          type: "pane.agent_status_changed",
          pane_id: "pane-1",
          workspace_id: "workspace-1",
          agent_status: "working",
        }),
      ),
    ).toEqual({ status: "invalid_known" });
  });

  it("ignores unknown activity stream messages", () => {
    expect(parseActivityEventData(JSON.stringify({ type: "future.event" }))).toEqual({
      status: "ignored",
    });
  });
});

describe("applyActivityMessage", () => {
  it("patches known panes and recomputes aggregate status", () => {
    const data = snapshot([{ ...pane("pane-1"), title: "Old", state_labels: { idle: "Waiting" } }]);
    const result = applyActivityMessage(data, {
      type: "pane.agent_status_changed",
      pane_id: "pane-1",
      workspace_id: "workspace-1",
      agent_status: "working",
      agent: "codex",
      title: "Reviewing",
      display_agent: "Codex",
      state_labels: { working: "Running" },
    });

    expect(result.status).toBe("applied");
    expect(result.snapshot?.panes[0]).toMatchObject({
      agent_status: "working",
      agent: "codex",
      title: "Reviewing",
      display_agent: "Codex",
      state_labels: { working: "Running" },
    });
    expect(result.snapshot?.workspaces[0].agent_status).toBe("working");
    expect(result.snapshot?.tabs[0].agent_status).toBe("working");
  });

  it("clears nullable presentation fields by replacing them", () => {
    const data = snapshot([
      {
        ...pane("pane-1"),
        agent: "codex",
        title: "Old",
        display_agent: "Codex",
        state_labels: { idle: "Waiting" },
      },
    ]);
    const result = applyActivityMessage(data, {
      type: "pane.agent_status_changed",
      pane_id: "pane-1",
      workspace_id: "workspace-1",
      agent_status: "idle",
      agent: null,
      title: null,
      display_agent: null,
      state_labels: {},
    });

    expect(result.status).toBe("applied");
    expect(result.snapshot?.panes[0].agent).toBeUndefined();
    expect(result.snapshot?.panes[0].title).toBeUndefined();
    expect(result.snapshot?.panes[0].display_agent).toBeUndefined();
    expect(result.snapshot?.panes[0].state_labels).toEqual({});
  });

  it("requests resync for unknown panes and resync controls", () => {
    const data = snapshot([pane("pane-1")]);

    expect(
      applyActivityMessage(data, {
        type: "pane.agent_status_changed",
        pane_id: "missing",
        workspace_id: "workspace-1",
        agent_status: "working",
        agent: null,
        title: null,
        display_agent: null,
        state_labels: {},
      }).status,
    ).toBe("resync");
    expect(applyActivityMessage(data, { type: "resync_required", reason: "lagged" }).status).toBe(
      "resync",
    );
  });
});

describe("replayActivityMessages", () => {
  it("replays only messages newer than the fetched snapshot generation", () => {
    const data = snapshot([pane("pane-1")]);
    const replayed = replayActivityMessages(
      data,
      [
        {
          generation: 2,
          message: {
            type: "pane.agent_status_changed",
            pane_id: "pane-1",
            workspace_id: "workspace-1",
            agent_status: "done",
            agent: null,
            title: "old",
            display_agent: null,
            state_labels: {},
          },
        },
        {
          generation: 3,
          message: {
            type: "pane.agent_status_changed",
            pane_id: "pane-1",
            workspace_id: "workspace-1",
            agent_status: "working",
            agent: "codex",
            title: "new",
            display_agent: "Codex",
            state_labels: { working: "Running" },
          },
        },
      ],
      2,
    );

    expect(replayed.panes[0]).toMatchObject({
      agent_status: "working",
      title: "new",
      state_labels: { working: "Running" },
    });
  });

  it("skips replay entries that require a full resync", () => {
    const data = snapshot([pane("pane-1")]);
    const replayed = replayActivityMessages(
      data,
      [
        {
          generation: 3,
          message: {
            type: "pane.agent_status_changed",
            pane_id: "missing",
            workspace_id: "workspace-1",
            agent_status: "working",
            agent: null,
            title: "missing",
            display_agent: null,
            state_labels: {},
          },
        },
        { generation: 4, message: { type: "resync_required", reason: "lagged" } },
        {
          generation: 5,
          message: {
            type: "pane.agent_status_changed",
            pane_id: "pane-1",
            workspace_id: "workspace-1",
            agent_status: "blocked",
            agent: null,
            title: "blocked",
            display_agent: null,
            state_labels: {},
          },
        },
      ],
      2,
    );

    expect(replayed.panes[0]).toMatchObject({
      agent_status: "blocked",
      title: "blocked",
    });
  });
});
