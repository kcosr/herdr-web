import {
  ChevronLeft,
  PanelLeft,
  Plus,
  RefreshCw,
  Settings,
  SplitSquareHorizontal,
  SplitSquareVertical,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { AgentIcon, agentIconKind } from "./AgentIcon";
import { BackendSettingsDialog } from "./BackendSettingsDialog";
import { useBridge } from "./bridge";
import { createCommands, createdPaneId } from "./commands";
import type { LaunchSpec, PaneFocusDirection, SplitDirection } from "./commands";
import {
  currentConnectionSnapshot,
  isConnectionResultCurrent,
} from "./connectionState";
import { LaunchDialog } from "./LaunchDialog";
import { resolveLaunchSpec } from "./launch";
import type { LaunchTarget } from "./launch";
import {
  DEFAULT_MOBILE_KEYBOARD_HIDE_REFIT,
  DEFAULT_MOBILE_TOUCH_SELECTION,
  DEFAULT_MOBILE_TERMINAL_TAP_TARGET,
  parseMobileKeyboardHideRefit,
  parseMobileTouchSelection,
  parseMobileTerminalTapTarget,
} from "./mobileTerminalPrefs";
import type { MobileTerminalTapTarget } from "./mobileTerminalPrefs";
import { addNativeBackHandler, addNativeKeyboardHideHandler, isNativeAndroid } from "./native";
import { ActionMenu, ConfirmDialog, RenameDialog, useLongPress } from "./overlays";
import type { MenuItem } from "./overlays";
import { TerminalView } from "./TerminalView";
import {
  aggregateStatus,
  canClearTabName,
  canClearWorkspaceName,
  choosePaneForTab,
  choosePaneForWorkspace,
  chooseSelectedPane,
  countAttention,
  displayTabLabel,
  isAttention,
  isLoud,
  paneMeta,
  paneTitle,
  sortPanesForTab,
  sortTabsForWorkspace,
  spaceSubtitle,
  statusLabel,
} from "./state";
import type { AgentStatus, PaneInfo, Snapshot, TabInfo, WorkspaceInfo } from "./types";

type LoadState = "loading" | "ready" | "error";
type Scope = "space" | "all";
type SidebarView = "agents" | "tabs";
type AgentSort = "attention" | "status" | "workspace";
type AgentGroup = "none" | "workspace";
type MenuKind = "space" | "tab" | "pane";
type MenuState = {
  kind: MenuKind;
  id: string;
  label: string;
  x: number;
  y: number;
  clearable?: boolean;
};
type DialogState = {
  mode: "rename" | "close";
  kind: MenuKind;
  id: string;
  label: string;
  clearable?: boolean;
};
type DisplayPrefs = {
  scope: Scope;
  sidebarView: SidebarView;
  agentSort: AgentSort;
  agentGroup: AgentGroup;
  sidebarWidth: number;
  sidebarOpen: boolean;
  activeSpaceId: string | null;
  selectedPaneId: string | null;
  mobileTerminalTapTarget: MobileTerminalTapTarget;
  mobileTouchSelection: boolean;
  mobileKeyboardHideRefit: boolean;
};

const COMPACT_LAYOUT_QUERY = "(max-width: 820px)";
const TOUCH_INPUT_QUERY = "(hover: none) and (pointer: coarse)";
const DISPLAY_PREFS_KEY = "herdr.mobileWeb.displayPrefs.v1";
const MOBILE_SIDEBAR_HISTORY_KEY = "herdrWebMobileSidebar";
const MOBILE_DETAIL_HISTORY_KEY = "herdrWebMobileDetail";
const DEFAULT_SIDEBAR_WIDTH = 320;
const MIN_SIDEBAR_WIDTH = 260;
const MAX_SIDEBAR_WIDTH = 560;

function readDisplayPrefs(): DisplayPrefs {
  const fallback: DisplayPrefs = {
    scope: "space",
    sidebarView: "agents",
    agentSort: "attention",
    agentGroup: "none",
    sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
    sidebarOpen: true,
    activeSpaceId: null,
    selectedPaneId: null,
    mobileTerminalTapTarget: DEFAULT_MOBILE_TERMINAL_TAP_TARGET,
    mobileTouchSelection: DEFAULT_MOBILE_TOUCH_SELECTION,
    mobileKeyboardHideRefit: DEFAULT_MOBILE_KEYBOARD_HIDE_REFIT,
  };
  try {
    const raw = window.localStorage.getItem(DISPLAY_PREFS_KEY);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw) as Partial<DisplayPrefs>;
    return {
      scope: parsed.scope === "all" || parsed.scope === "space" ? parsed.scope : fallback.scope,
      sidebarView:
        parsed.sidebarView === "agents" || parsed.sidebarView === "tabs"
          ? parsed.sidebarView
          : fallback.sidebarView,
      agentSort:
        parsed.agentSort === "attention" ||
        parsed.agentSort === "status" ||
        parsed.agentSort === "workspace"
          ? parsed.agentSort
          : fallback.agentSort,
      agentGroup:
        parsed.agentGroup === "none" || parsed.agentGroup === "workspace"
          ? parsed.agentGroup
          : fallback.agentGroup,
      sidebarWidth:
        typeof parsed.sidebarWidth === "number"
          ? clampSidebarWidth(parsed.sidebarWidth)
          : fallback.sidebarWidth,
      sidebarOpen:
        typeof parsed.sidebarOpen === "boolean" ? parsed.sidebarOpen : fallback.sidebarOpen,
      activeSpaceId:
        typeof parsed.activeSpaceId === "string" ? parsed.activeSpaceId : fallback.activeSpaceId,
      selectedPaneId:
        typeof parsed.selectedPaneId === "string" ? parsed.selectedPaneId : fallback.selectedPaneId,
      mobileTerminalTapTarget: parseMobileTerminalTapTarget(parsed.mobileTerminalTapTarget),
      mobileTouchSelection: parseMobileTouchSelection(parsed.mobileTouchSelection),
      mobileKeyboardHideRefit: parseMobileKeyboardHideRefit(parsed.mobileKeyboardHideRefit),
    };
  } catch {
    return fallback;
  }
}

function clampSidebarWidth(width: number) {
  const viewportMax =
    typeof window === "undefined"
      ? MAX_SIDEBAR_WIDTH
      : Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, window.innerWidth - 360));
  return Math.round(Math.min(Math.max(width, MIN_SIDEBAR_WIDTH), viewportMax));
}

function writeDisplayPrefs(prefs: DisplayPrefs) {
  try {
    window.localStorage.setItem(DISPLAY_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage can be unavailable in private or locked-down browser contexts.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMobileDetailHistoryState(value: unknown) {
  return isRecord(value) && value[MOBILE_DETAIL_HISTORY_KEY] === true;
}

function isMobileSidebarHistoryState(value: unknown) {
  return isRecord(value) && value[MOBILE_SIDEBAR_HISTORY_KEY] === true;
}

function withMobileSidebarHistoryState(value: unknown) {
  const next = { ...(isRecord(value) ? value : {}) };
  delete next[MOBILE_DETAIL_HISTORY_KEY];
  return {
    ...next,
    [MOBILE_SIDEBAR_HISTORY_KEY]: true,
  };
}

function withMobileDetailHistoryState(value: unknown) {
  return {
    ...(isRecord(value) ? value : {}),
    [MOBILE_SIDEBAR_HISTORY_KEY]: true,
    [MOBILE_DETAIL_HISTORY_KEY]: true,
  };
}

function stripMobileHistoryState(value: unknown) {
  if (!isRecord(value)) {
    return {};
  }
  const next = { ...value };
  delete next[MOBILE_SIDEBAR_HISTORY_KEY];
  delete next[MOBILE_DETAIL_HISTORY_KEY];
  return next;
}

export function App() {
  const bridge = useBridge();
  const commands = useMemo(() => createCommands(bridge.httpUrl), [bridge.httpUrl]);
  const initialPrefs = useMemo(readDisplayPrefs, []);
  const [snapshotState, setSnapshot] = useState<Snapshot | null>(null);
  const [snapshotConnectionKey, setSnapshotConnectionKey] = useState(bridge.connectionKey);
  const [selectedPaneId, setSelectedPaneId] = useState<string | null>(initialPrefs.selectedPaneId);
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(initialPrefs.activeSpaceId);
  const [scope, setScope] = useState<Scope>(initialPrefs.scope);
  const [sidebarView, setSidebarView] = useState<SidebarView>(initialPrefs.sidebarView);
  const [agentSort, setAgentSort] = useState<AgentSort>(initialPrefs.agentSort);
  const [agentGroup, setAgentGroup] = useState<AgentGroup>(initialPrefs.agentGroup);
  const [sidebarWidth, setSidebarWidth] = useState(initialPrefs.sidebarWidth);
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [sidebarOpen, setSidebarOpen] = useState(initialPrefs.sidebarOpen);
  const [showDetail, setShowDetail] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [backendSettingsOpen, setBackendSettingsOpen] = useState(false);
  const [mobileTerminalTapTarget, setMobileTerminalTapTarget] = useState(
    initialPrefs.mobileTerminalTapTarget,
  );
  const [mobileTouchSelection, setMobileTouchSelection] = useState(
    initialPrefs.mobileTouchSelection,
  );
  const [mobileKeyboardHideRefit, setMobileKeyboardHideRefit] = useState(
    initialPrefs.mobileKeyboardHideRefit,
  );
  const [launchTarget, setLaunchTarget] = useState<LaunchTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refitToken, setRefitToken] = useState(0);
  const [terminalFocusToken, setTerminalFocusToken] = useState(0);
  const isCompactLayout = useIsCompactLayout();
  const isTouchInput = useIsTouchInput();
  const showMobileKeyboardHideRefit = isNativeAndroid();
  const snapshotRef = useRef<Snapshot | null>(null);
  const isCompactLayoutRef = useRef(isCompactLayout);
  const showDetailRef = useRef(showDetail);
  const connectionKeyRef = useRef(bridge.connectionKey);
  const mobileSidebarHistoryRef = useRef(false);
  const mobileDetailHistoryRef = useRef(false);
  const sidebarResizePressRef = useRef<{
    timer: number;
    pointerId: number;
    x: number;
    y: number;
    target: HTMLDivElement;
  } | null>(null);

  useEffect(() => {
    return addNativeBackHandler(() => {
      if (backendSettingsOpen) {
        setBackendSettingsOpen(false);
        return true;
      }
      if (launchTarget) {
        setLaunchTarget(null);
        return true;
      }
      if (dialog) {
        setDialog(null);
        return true;
      }
      if (menu) {
        setMenu(null);
        return true;
      }
      return false;
    });
  }, [backendSettingsOpen, dialog, launchTarget, menu]);

  const snapshot = currentConnectionSnapshot(
    snapshotState,
    snapshotConnectionKey,
    bridge.connectionKey,
  );
  const resolvedPaneId = chooseSelectedPane(snapshot, selectedPaneId);
  const supportedCommands = bridge.capabilities?.commands ?? [];
  const splitSupported = supportedCommands.includes("pane.split");
  const paneFocusSupported = supportedCommands.includes("pane.focus_direction");
  const paneMoveSupported = supportedCommands.includes("pane.move");

  const ensureMobileSidebarHistory = () => {
    if (!isCompactLayoutRef.current || isMobileDetailHistoryState(window.history.state)) {
      return;
    }
    if (isMobileSidebarHistoryState(window.history.state)) {
      mobileSidebarHistoryRef.current = true;
      return;
    }
    window.history.pushState(
      withMobileSidebarHistoryState(window.history.state),
      "",
      window.location.href,
    );
    mobileSidebarHistoryRef.current = true;
  };

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    isCompactLayoutRef.current = isCompactLayout;
    if (isCompactLayout) {
      ensureMobileSidebarHistory();
      return;
    }
    mobileSidebarHistoryRef.current = false;
    mobileDetailHistoryRef.current = false;
    if (
      isMobileSidebarHistoryState(window.history.state) ||
      isMobileDetailHistoryState(window.history.state)
    ) {
      window.history.replaceState(stripMobileHistoryState(window.history.state), "", window.location.href);
    }
  }, [isCompactLayout]);

  useEffect(() => {
    showDetailRef.current = showDetail;
  }, [showDetail]);

  useEffect(() => {
    setSelectedPaneId((current) => chooseSelectedPane(snapshot, current));
  }, [snapshot]);

  useEffect(() => {
    writeDisplayPrefs({
      scope,
      sidebarView,
      agentSort,
      agentGroup,
      sidebarWidth,
      sidebarOpen,
      activeSpaceId,
      selectedPaneId,
      mobileTerminalTapTarget,
      mobileTouchSelection,
      mobileKeyboardHideRefit,
    });
  }, [
    scope,
    sidebarView,
    agentSort,
    agentGroup,
    sidebarWidth,
    sidebarOpen,
    activeSpaceId,
    selectedPaneId,
    mobileTerminalTapTarget,
    mobileTouchSelection,
    mobileKeyboardHideRefit,
  ]);

  useEffect(() => {
    if (!mobileKeyboardHideRefit || !showMobileKeyboardHideRefit) {
      return;
    }

    const requestRefit = () => setRefitToken((token) => token + 1);
    return addNativeKeyboardHideHandler(() => {
      blurActiveTextInput();
      requestRefit();
      const frame = window.requestAnimationFrame(requestRefit);
      const timers = [80, 280].map((delay) => window.setTimeout(requestRefit, delay));
      window.setTimeout(() => {
        window.cancelAnimationFrame(frame);
        for (const timer of timers) {
          window.clearTimeout(timer);
        }
      }, 360);
    });
  }, [mobileKeyboardHideRefit, showMobileKeyboardHideRefit]);

  useEffect(() => {
    setSidebarWidth((width) => clampSidebarWidth(width));
  }, [isCompactLayout]);

  const clearSidebarResizePress = () => {
    const pending = sidebarResizePressRef.current;
    if (!pending) {
      return;
    }
    window.clearTimeout(pending.timer);
    if (pending.target.hasPointerCapture(pending.pointerId)) {
      pending.target.releasePointerCapture(pending.pointerId);
    }
    sidebarResizePressRef.current = null;
  };

  useEffect(() => {
    if (!resizingSidebar) {
      return;
    }
    const onPointerMove = (event: PointerEvent) => {
      setSidebarWidth(clampSidebarWidth(event.clientX));
    };
    const onPointerUp = () => setResizingSidebar(false);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    window.addEventListener("pointercancel", onPointerUp, { once: true });
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [resizingSidebar]);

  useEffect(
    () => () => {
      const pending = sidebarResizePressRef.current;
      if (!pending) {
        return;
      }
      window.clearTimeout(pending.timer);
      if (pending.target.hasPointerCapture(pending.pointerId)) {
        pending.target.releasePointerCapture(pending.pointerId);
      }
      sidebarResizePressRef.current = null;
    },
    [],
  );

  useEffect(() => {
    let disposed = false;
    if (connectionKeyRef.current !== bridge.connectionKey) {
      connectionKeyRef.current = bridge.connectionKey;
      setSnapshot(null);
      setSnapshotConnectionKey(bridge.connectionKey);
      setSelectedPaneId(null);
      setActiveSpaceId(null);
    }
    if (!bridge.canConnect) {
      setSnapshot(null);
      setSnapshotConnectionKey(bridge.connectionKey);
      setSelectedPaneId(null);
      setActiveSpaceId(null);
      setLoadState("ready");
      return () => {
        disposed = true;
      };
    }
    const refresh = () =>
      refreshSnapshot(
        bridge.httpUrl,
        (next) => {
          setSnapshot(next);
          setSnapshotConnectionKey(bridge.connectionKey);
        },
        setLoadState,
        () => disposed,
      );
    void refresh();
    const interval = window.setInterval(refresh, 10000);
    const events = openEventsSocket(bridge.wsUrl, "/ws/events", () => void refresh());
    const uiEvents = openEventsSocket(bridge.wsUrl, "/ws/ui-events", (event) => {
      const paneId = selectionPaneId(event);
      if (paneId) {
        setSelectedPaneId(paneId);
        const pane = snapshotRef.current?.panes.find((item) => item.pane_id === paneId);
        if (pane) {
          setActiveSpaceId(pane.workspace_id);
        }
      }
      void refresh();
    });
    return () => {
      disposed = true;
      events?.close();
      uiEvents?.close();
      window.clearInterval(interval);
    };
  }, [bridge.canConnect, bridge.connectionKey, bridge.httpUrl, bridge.resumeToken, bridge.wsUrl]);

  useEffect(() => {
    if (!error) {
      return;
    }
    const timer = window.setTimeout(() => setError(null), 4500);
    return () => window.clearTimeout(timer);
  }, [error]);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      if (!isCompactLayoutRef.current) {
        return;
      }
      if (isMobileDetailHistoryState(event.state)) {
        mobileSidebarHistoryRef.current = true;
        mobileDetailHistoryRef.current = true;
        if (!showDetailRef.current) {
          showDetailRef.current = true;
          setShowDetail(true);
        }
        return;
      }
      if (mobileDetailHistoryRef.current || showDetailRef.current) {
        mobileDetailHistoryRef.current = false;
        mobileSidebarHistoryRef.current = isMobileSidebarHistoryState(event.state);
        showDetailRef.current = false;
        setShowDetail(false);
        return;
      }
      if (isMobileSidebarHistoryState(event.state)) {
        mobileSidebarHistoryRef.current = true;
        return;
      }
      mobileSidebarHistoryRef.current = false;
      window.setTimeout(ensureMobileSidebarHistory, 0);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const selectedPane = useMemo(
    () => snapshot?.panes.find((pane) => pane.pane_id === resolvedPaneId) ?? null,
    [snapshot, resolvedPaneId],
  );
  const selectedPaneMenuPress = useLongPress((x, y) => {
    if (selectedPane) {
      setMenu({
        kind: "pane",
        id: selectedPane.pane_id,
        label: paneTitle(selectedPane),
        x,
        y,
      });
    }
  });

  useEffect(() => {
    if (isCompactLayout) {
      window.scrollTo(0, 0);
      document.documentElement.scrollLeft = 0;
      document.body.scrollLeft = 0;
    }
  }, [isCompactLayout, showDetail]);

  const activeSpace = useMemo(() => {
    if (!snapshot || snapshot.workspaces.length === 0) {
      return null;
    }
    return (
      (activeSpaceId &&
        snapshot.workspaces.find((workspace) => workspace.workspace_id === activeSpaceId)) ||
      (selectedPane &&
        snapshot.workspaces.find(
          (workspace) => workspace.workspace_id === selectedPane.workspace_id,
        )) ||
      snapshot.workspaces.find((workspace) => workspace.focused) ||
      snapshot.workspaces[0] ||
      null
    );
  }, [snapshot, activeSpaceId, selectedPane]);

  // The active tab's split layout, normalized to fractions of the tab area so we
  // can reproduce the herdr split geometry in the browser. Null when the tab has
  // a single pane (or is zoomed) — then we render one terminal full-screen.
  const splitCells = useMemo<{ pane: PaneInfo; style: CSSProperties }[] | null>(() => {
    if (!snapshot || !selectedPane) {
      return null;
    }
    const layout = snapshot.layouts.find((item) =>
      item.panes.some((pane) => pane.pane_id === selectedPane.pane_id),
    );
    if (!layout || layout.zoomed || layout.panes.length < 2) {
      return null;
    }
    const { area } = layout;
    if (area.width <= 0 || area.height <= 0) {
      return null;
    }
    const cells: { pane: PaneInfo; style: CSSProperties }[] = [];
    for (const lp of layout.panes) {
      const pane = snapshot.panes.find((item) => item.pane_id === lp.pane_id);
      if (!pane) {
        continue;
      }
      cells.push({
        pane,
        style: {
          left: `${((lp.rect.x - area.x) / area.width) * 100}%`,
          top: `${((lp.rect.y - area.y) / area.height) * 100}%`,
          width: `${(lp.rect.width / area.width) * 100}%`,
          height: `${(lp.rect.height / area.height) * 100}%`,
        },
      });
    }
    return cells.length > 1 ? cells : null;
  }, [snapshot, selectedPane]);

  const showSplit = !isCompactLayout && splitCells !== null;

  // Mirror browser navigation to the herdr session so `active_tab_id` tracks
  // what we're viewing here. `tab.focus` also activates the tab's workspace, so
  // a workspace-only focus is just the fallback for a space with no panes yet.
  const pushFocus = (tabId?: string, workspaceId?: string) => {
    if (tabId) {
      void commands.focusTab(tabId).catch(() => {});
    } else if (workspaceId) {
      void commands.focusWorkspace(workspaceId).catch(() => {});
    }
  };

  const openMobileDetail = () => {
    ensureMobileSidebarHistory();
    showDetailRef.current = true;
    setShowDetail(true);
    if (!mobileDetailHistoryRef.current) {
      window.history.pushState(
        withMobileDetailHistoryState(window.history.state),
        "",
        window.location.href,
      );
      mobileDetailHistoryRef.current = true;
    }
  };

  const closeMobileDetail = () => {
    if (mobileDetailHistoryRef.current && isMobileDetailHistoryState(window.history.state)) {
      window.history.back();
      return;
    }
    mobileDetailHistoryRef.current = false;
    showDetailRef.current = false;
    setShowDetail(false);
  };

  const openPane = (pane: PaneInfo) => {
    setSelectedPaneId(pane.pane_id);
    setActiveSpaceId(pane.workspace_id);
    void syncSelectedPane(bridge.httpUrl, pane.pane_id).catch(() => {});
    pushFocus(pane.tab_id, pane.workspace_id);
    if (isCompactLayout) {
      openMobileDetail();
    }
  };

  const requestTerminalFocus = () => setTerminalFocusToken((token) => token + 1);

  const selectSpace = (workspaceId: string) => {
    setActiveSpaceId(workspaceId);
    if (!isCompactLayout && snapshot) {
      const paneId = choosePaneForWorkspace(snapshot, workspaceId);
      if (paneId) {
        setSelectedPaneId(paneId);
        const pane = snapshot.panes.find((item) => item.pane_id === paneId);
        void syncSelectedPane(bridge.httpUrl, paneId).catch(() => {});
        pushFocus(pane?.tab_id, workspaceId);
        return;
      }
      setSelectedPaneId(null);
    }
    pushFocus(undefined, workspaceId);
  };

  const selectTab = (tabId: string) => {
    if (!snapshot) {
      return;
    }
    const paneId = choosePaneForTab(snapshot, tabId);
    if (paneId) {
      const pane = snapshot.panes.find((item) => item.pane_id === paneId);
      if (pane) {
        openPane(pane);
      }
    }
  };

  const focusTab = (tabId: string) => {
    selectTab(tabId);
    requestTerminalFocus();
  };

  const focusPane = (pane: PaneInfo) => {
    openPane(pane);
    requestTerminalFocus();
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const navigationShortcut = isAppNavigationShortcut(event);
      const closeTabShortcut = isCloseTabShortcut(event);
      const newTabShortcut = isNewTabShortcut(event);
      const splitDirection = splitSupported ? splitShortcutDirection(event) : null;
      const paneFocusDirection = paneFocusSupported ? paneFocusShortcutDirection(event) : null;
      const paneCycleStep = paneCycleShortcutStep(event);
      if (
        (!navigationShortcut &&
          !closeTabShortcut &&
          !newTabShortcut &&
          !splitDirection &&
          !paneFocusDirection &&
          paneCycleStep === 0) ||
        isShortcutTextEntryTarget(event.target) ||
        !snapshot ||
        busy ||
        menu ||
        dialog ||
        launchTarget ||
        hasOpenModal()
      ) {
        return;
      }

      if (paneFocusDirection) {
        if (!selectedPane) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        void exec(
          () => commands.focusPaneDirection(selectedPane.pane_id, paneFocusDirection),
          true,
        ).then((ok) => ok && requestTerminalFocus());
        return;
      }

      if (paneCycleStep !== 0) {
        const panes = orderedShortcutTabPanes(snapshot, activeSpace, selectedPane);
        if (panes.length === 0) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const currentIndex = selectedPane
          ? panes.findIndex((pane) => pane.pane_id === selectedPane.pane_id)
          : -1;
        const fallbackIndex = paneCycleStep > 0 ? 0 : panes.length - 1;
        const nextIndex =
          currentIndex === -1
            ? fallbackIndex
            : (currentIndex + paneCycleStep + panes.length) % panes.length;
        focusPane(panes[nextIndex]);
        return;
      }

      if (splitDirection) {
        if (!selectedPane) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        void exec(() => commands.splitPane(selectedPane.pane_id, splitDirection), true).then(
          (ok) => ok && requestTerminalFocus(),
        );
        return;
      }

      if (newTabShortcut) {
        if (!activeSpace) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        setLaunchTarget({ mode: "tab", workspaceId: activeSpace.workspace_id });
        return;
      }

      if (closeTabShortcut) {
        const tab = activeShortcutTab(snapshot, activeSpace, selectedPane);
        if (!tab) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const tabPanes = sortPanesForTab(snapshot.panes, tab.tab_id);
        if (tabPanes.length > 1 && selectedPane?.tab_id === tab.tab_id) {
          setDialog({
            mode: "close",
            kind: "pane",
            id: selectedPane.pane_id,
            label: paneTitle(selectedPane),
          });
          return;
        }
        setDialog({
          mode: "close",
          kind: "tab",
          id: tab.tab_id,
          label: displayTabLabel(tab, snapshot.panes),
        });
        return;
      }

      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        const agentPanes = orderedShortcutAgentPanes(
          snapshot,
          scope,
          activeSpace?.workspace_id,
          agentSort,
          agentGroup,
        );
        if (agentPanes.length === 0) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const currentIndex = selectedPane
          ? agentPanes.findIndex((pane) => pane.pane_id === selectedPane.pane_id)
          : -1;
        const step = event.key === "ArrowDown" ? 1 : -1;
        const fallbackIndex = step > 0 ? 0 : agentPanes.length - 1;
        const nextIndex =
          currentIndex === -1
            ? fallbackIndex
            : (currentIndex + step + agentPanes.length) % agentPanes.length;
        focusPane(agentPanes[nextIndex]);
        return;
      }

      const workspace = activeSpace;
      if (!workspace || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) {
        return;
      }
      const tabs = sortTabsForWorkspace(snapshot.tabs, workspace.workspace_id);
      if (tabs.length === 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const activeTabId =
        selectedPane && selectedPane.workspace_id === workspace.workspace_id
          ? selectedPane.tab_id
          : workspace.active_tab_id;
      const currentIndex = tabs.findIndex((tab) => tab.tab_id === activeTabId);
      const step = event.key === "ArrowRight" ? 1 : -1;
      const fallbackIndex = step > 0 ? 0 : tabs.length - 1;
      const nextIndex =
        currentIndex === -1 ? fallbackIndex : (currentIndex + step + tabs.length) % tabs.length;
      focusTab(tabs[nextIndex].tab_id);
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [
    activeSpace,
    agentGroup,
    agentSort,
    busy,
    dialog,
    isCompactLayout,
    launchTarget,
    menu,
    paneFocusSupported,
    scope,
    selectedPane,
    splitSupported,
    snapshot,
  ]);

  const refreshNow = () => {
    if (!bridge.canConnect) {
      setBackendSettingsOpen(true);
      return;
    }
    const requestConnectionKey = bridge.connectionKey;
    setLoadState("loading");
    void fetchSnapshot(bridge.httpUrl)
      .then((next) => {
        if (!isConnectionResultCurrent(connectionKeyRef.current, requestConnectionKey)) {
          return;
        }
        setSnapshot(next);
        setSnapshotConnectionKey(requestConnectionKey);
        setLoadState("ready");
      })
      .catch(() => {
        if (connectionKeyRef.current === requestConnectionKey) {
          setLoadState("error");
        }
      });
  };

  async function exec(action: () => Promise<{ [key: string]: unknown }>, selectCreated = false) {
    const requestConnectionKey = bridge.connectionKey;
    setBusy(true);
    try {
      const result = await action();
      const next = await fetchSnapshot(bridge.httpUrl);
      if (!isConnectionResultCurrent(connectionKeyRef.current, requestConnectionKey)) {
        return false;
      }
      setSnapshot(next);
      setSnapshotConnectionKey(requestConnectionKey);
      setLoadState("ready");
      if (selectCreated) {
        const paneId = createdPaneId(result);
        const created = paneId ? next.panes.find((pane) => pane.pane_id === paneId) : undefined;
        if (created) {
          setSelectedPaneId(created.pane_id);
          setActiveSpaceId(created.workspace_id);
          void syncSelectedPane(bridge.httpUrl, created.pane_id).catch(() => {});
          if (isCompactLayout) {
            openMobileDetail();
          }
        }
      }
      setError(null);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Command failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const onMenuPick = (key: string) => {
    if (!menu) {
      return;
    }
    const { kind, id, label, clearable } = menu;
    setMenu(null);
    if (key === "rename") {
      setDialog({ mode: "rename", kind, id, label, clearable });
    } else if (key === "close") {
      setDialog({ mode: "close", kind, id, label });
    } else if (key === "newtab") {
      setActiveSpaceId(id);
      setLaunchTarget({ mode: "tab", workspaceId: id });
    } else if (key === "move_new_tab" && kind === "pane") {
      const pane = snapshotRef.current?.panes.find((item) => item.pane_id === id);
      if (!pane) {
        setError("Pane not found");
        return;
      }
      void exec(() => commands.movePaneToNewTab(id, pane.workspace_id, label), true);
    } else if (key === "move_new_space" && kind === "pane") {
      void exec(() => commands.movePaneToNewWorkspace(id, label), true);
    }
  };

  const submitRename = (value: string) => {
    if (!dialog) {
      return;
    }
    const { kind, id } = dialog;
    const action =
      kind === "space"
        ? () => commands.renameWorkspace(id, value)
        : kind === "tab"
          ? () => commands.renameTab(id, value)
          : () => commands.renamePane(id, value);
    void exec(action).then((ok) => ok && setDialog(null));
  };

  const clearRename = () => {
    if (!dialog || dialog.kind === "pane") {
      return;
    }
    const { kind, id } = dialog;
    const action =
      kind === "space"
        ? () => commands.renameWorkspace(id, null)
        : () => commands.renameTab(id, null);
    void exec(action).then((ok) => ok && setDialog(null));
  };

  const confirmClose = () => {
    if (!dialog) {
      return;
    }
    const { kind, id } = dialog;
    const action =
      kind === "space"
        ? () => commands.closeWorkspace(id)
        : kind === "tab"
          ? () => commands.closeTab(id)
          : () => commands.closePane(id);
    void exec(action).then((ok) => ok && setDialog(null));
  };

  const submitLaunch = (spec: LaunchSpec) => {
    if (!launchTarget) {
      return;
    }
    const resolvedSpec = resolveLaunchSpec(spec, snapshot?.panes ?? []);
    const action =
      launchTarget.mode === "tab"
        ? () => commands.createLaunchTab(launchTarget.workspaceId, resolvedSpec)
        : () =>
            commands.splitLaunchPane(
              launchTarget.pane.pane_id,
              launchTarget.pane.tab_id,
              launchTarget.direction,
              resolvedSpec,
            );
    void exec(action, true).then((ok) => ok && setLaunchTarget(null));
  };

  const renderTerminal = !isCompactLayout || showDetail;
  const appStyle = { "--sidebar-w": `${sidebarWidth}px` } as CSSProperties &
    Record<"--sidebar-w", string>;

  return (
    <div
      className="app"
      style={appStyle}
      data-sidebar={sidebarOpen ? "open" : "closed"}
      data-resizing-sidebar={resizingSidebar ? "true" : "false"}
      data-compact={isCompactLayout ? "true" : "false"}
      data-touch={isTouchInput ? "true" : "false"}
      data-detail={isCompactLayout && showDetail ? "true" : "false"}
    >
      <aside className="sidebar" aria-label="Switcher">
        <Switcher
          snapshot={snapshot}
          loadState={loadState}
          bridgeCanConnect={bridge.canConnect}
          bridgeError={bridge.capabilityError}
          bridgeLabel={bridge.activeBackend?.name ?? "same-origin"}
          bridgeMode={bridge.mode}
          capabilityState={bridge.capabilityState}
          scope={scope}
          sidebarView={sidebarView}
          agentSort={agentSort}
          agentGroup={agentGroup}
          activeSpace={activeSpace}
          selectedPane={selectedPane}
          onScope={setScope}
          onSidebarView={setSidebarView}
          onAgentSort={setAgentSort}
          onAgentGroup={setAgentGroup}
          onSelectSpace={selectSpace}
          onSelectTab={selectTab}
          onSelectPane={openPane}
          onRefresh={refreshNow}
          onBackendSettings={() => setBackendSettingsOpen(true)}
          onCreateSpace={() => void exec(() => commands.createWorkspace(), true)}
          onCreateTab={(workspaceId) => setLaunchTarget({ mode: "tab", workspaceId })}
          onMenu={(kind, id, label, x, y, clearable) =>
            setMenu({ kind, id, label, x, y, clearable })
          }
        />
        <div
          className="sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-valuemin={MIN_SIDEBAR_WIDTH}
          aria-valuemax={MAX_SIDEBAR_WIDTH}
          aria-valuenow={sidebarWidth}
          tabIndex={0}
          onPointerDown={(event) => {
            if (isCompactLayout || !sidebarOpen) {
              return;
            }
            event.preventDefault();
            clearSidebarResizePress();
            if (event.pointerType === "mouse") {
              setResizingSidebar(true);
              return;
            }
            const target = event.currentTarget;
            target.setPointerCapture(event.pointerId);
            const x = event.clientX;
            const y = event.clientY;
            const pointerId = event.pointerId;
            const timer = window.setTimeout(() => {
              sidebarResizePressRef.current = null;
              if (target.hasPointerCapture(pointerId)) {
                target.releasePointerCapture(pointerId);
              }
              setSidebarWidth(clampSidebarWidth(x));
              setResizingSidebar(true);
            }, 360);
            sidebarResizePressRef.current = { timer, pointerId, x, y, target };
          }}
          onPointerMove={(event) => {
            const pending = sidebarResizePressRef.current;
            if (!pending || pending.pointerId !== event.pointerId) {
              return;
            }
            if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > 12) {
              clearSidebarResizePress();
            }
          }}
          onPointerUp={clearSidebarResizePress}
          onPointerCancel={clearSidebarResizePress}
          onKeyDown={(event) => {
            if (isCompactLayout) {
              return;
            }
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              const step = event.shiftKey ? 32 : 12;
              setSidebarWidth((width) =>
                clampSidebarWidth(width + (event.key === "ArrowRight" ? step : -step)),
              );
            } else if (event.key === "Home") {
              event.preventDefault();
              setSidebarWidth(MIN_SIDEBAR_WIDTH);
            } else if (event.key === "End") {
              event.preventDefault();
              setSidebarWidth(MAX_SIDEBAR_WIDTH);
            }
          }}
        />
      </aside>

      <section className="stage" aria-label="Terminal">
        <TabBar
          snapshot={snapshot}
          activeSpace={activeSpace}
          selectedPane={selectedPane}
          onSelectTab={selectTab}
          onCreateTab={(workspaceId) => setLaunchTarget({ mode: "tab", workspaceId })}
          onMenu={(kind, id, label, x, y, clearable) =>
            setMenu({ kind, id, label, x, y, clearable })
          }
        />
        <header className="stage-bar">
          <button
            className="icon-btn"
            type="button"
            aria-label={isCompactLayout ? "Back to switcher" : "Toggle sidebar"}
            title={isCompactLayout ? "Back" : "Toggle sidebar"}
            onClick={() => (isCompactLayout ? closeMobileDetail() : setSidebarOpen((open) => !open))}
          >
            {isCompactLayout ? <ChevronLeft size={20} /> : <PanelLeft size={18} />}
          </button>
          <div className="stage-id" {...selectedPaneMenuPress}>
            <span className="stage-title">{selectedPane ? paneTitle(selectedPane) : "herdr-web"}</span>
            <span className="stage-sub mono">
              {stageBreadcrumb(snapshot, selectedPane, loadState, bridge.canConnect)}
            </span>
          </div>
          {splitSupported && selectedPane && !isCompactLayout ? (
            <>
              <button
                className="icon-btn"
                type="button"
                aria-label="Split right"
                title="Split right"
                disabled={busy}
                onClick={() =>
                  setLaunchTarget({ mode: "split", pane: selectedPane, direction: "right" })
                }
              >
                <SplitSquareHorizontal size={18} />
              </button>
              <button
                className="icon-btn"
                type="button"
                aria-label="Split down"
                title="Split down"
                disabled={busy}
                onClick={() =>
                  setLaunchTarget({ mode: "split", pane: selectedPane, direction: "down" })
                }
              >
                <SplitSquareVertical size={18} />
              </button>
            </>
          ) : null}
          {selectedPane ? (
            <button
              className="icon-btn"
              type="button"
              aria-label="Refit terminal"
              title="Refit terminal"
              onClick={() => setRefitToken((token) => token + 1)}
            >
              <RefreshCw size={18} />
            </button>
          ) : null}
          {selectedPane ? <StatusBadge status={selectedPane.agent_status} /> : null}
        </header>
        {showSplit && splitCells ? (
          <SplitGrid
            cells={splitCells}
            selectedPaneId={selectedPane?.pane_id ?? null}
            onSelectPane={(pane) => {
              openPane(pane);
              if (isTouchInput) {
                requestTerminalFocus();
              }
            }}
            refitToken={refitToken}
            focusToken={terminalFocusToken}
            touchInput={isTouchInput}
            mobileTapTarget={mobileTerminalTapTarget}
            mobileTouchSelection={mobileTouchSelection}
            connectionKey={bridge.connectionKey}
            resumeToken={bridge.resumeToken}
            httpUrl={bridge.httpUrl}
            wsUrl={bridge.wsUrl}
          />
        ) : renderTerminal ? (
          <TerminalView
            pane={selectedPane}
            connectionKey={bridge.connectionKey}
            resumeToken={bridge.resumeToken}
            httpUrl={bridge.httpUrl}
            wsUrl={bridge.wsUrl}
            autoFocus={!isTouchInput}
            scrollSensitivity={isTouchInput ? 2 : 0.4}
            mobileControls={isTouchInput}
            mobileTapTarget={mobileTerminalTapTarget}
            mobileTouchSelection={mobileTouchSelection}
            refitToken={refitToken}
            focusToken={terminalFocusToken}
          />
        ) : (
          <div className="terminal-stage" aria-hidden="true" />
        )}
      </section>

      {menu ? (
        <ActionMenu
          x={menu.x}
          y={menu.y}
          title={menu.label}
          items={menuItems(menu.kind, paneMoveSupported)}
          onPick={onMenuPick}
          onClose={() => setMenu(null)}
        />
      ) : null}

      {dialog?.mode === "rename" ? (
        <RenameDialog
          title={`Rename ${dialog.kind}`}
          initial={dialog.label}
          placeholder={dialog.label}
          busy={busy}
          onCancel={() => setDialog(null)}
          onSubmit={submitRename}
          onClear={dialog.clearable ? clearRename : undefined}
        />
      ) : null}

      {dialog?.mode === "close" ? (
        <ConfirmDialog
          title={closeCopy(dialog.kind).title}
          message={closeCopy(dialog.kind).message}
          confirmLabel={closeCopy(dialog.kind).confirm}
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={confirmClose}
        />
      ) : null}

      {launchTarget ? (
        <LaunchDialog
          target={launchTarget}
          busy={busy}
          onCancel={() => setLaunchTarget(null)}
          onSubmit={submitLaunch}
        />
      ) : null}

      {backendSettingsOpen ? (
        <BackendSettingsDialog
          showMobileTerminalSettings={isTouchInput}
          mobileTerminalTapTarget={mobileTerminalTapTarget}
          onMobileTerminalTapTarget={setMobileTerminalTapTarget}
          mobileTouchSelection={mobileTouchSelection}
          onMobileTouchSelection={setMobileTouchSelection}
          showMobileKeyboardHideRefit={showMobileKeyboardHideRefit}
          mobileKeyboardHideRefit={mobileKeyboardHideRefit}
          onMobileKeyboardHideRefit={setMobileKeyboardHideRefit}
          onClose={() => setBackendSettingsOpen(false)}
        />
      ) : null}

      {error ? (
        <div className="toast" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function orderedShortcutAgentPanes(
  snapshot: Snapshot,
  scope: Scope,
  activeWorkspaceId: string | undefined,
  agentSort: AgentSort,
  agentGroup: AgentGroup,
) {
  const scoped =
    scope === "all"
      ? snapshot.panes
      : snapshot.panes.filter((pane) => pane.workspace_id === activeWorkspaceId);
  const agentPanes = sortAgentPanes(scoped.filter(isAgentPane), agentSort, snapshot);
  if (agentGroup !== "workspace") {
    return agentPanes;
  }

  const panesByWorkspace = new Map<string, PaneInfo[]>();
  for (const pane of agentPanes) {
    const panes = panesByWorkspace.get(pane.workspace_id) ?? [];
    panes.push(pane);
    panesByWorkspace.set(pane.workspace_id, panes);
  }

  return snapshot.workspaces.flatMap((workspace) => panesByWorkspace.get(workspace.workspace_id) ?? []);
}

function orderedShortcutTabPanes(
  snapshot: Snapshot,
  activeSpace: WorkspaceInfo | null,
  selectedPane: PaneInfo | null,
) {
  const tab = activeShortcutTab(snapshot, activeSpace, selectedPane);
  return tab ? sortPanesForTab(snapshot.panes, tab.tab_id) : [];
}

function isAppNavigationShortcut(event: KeyboardEvent) {
  return (
    isPlatformShortcutModifier(event) &&
    event.shiftKey &&
    (event.key === "ArrowUp" ||
      event.key === "ArrowDown" ||
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight")
  );
}

function isCloseTabShortcut(event: KeyboardEvent) {
  return (
    isPlatformShortcutModifier(event) &&
    event.shiftKey &&
    event.code === "KeyX"
  );
}

function isNewTabShortcut(event: KeyboardEvent) {
  return isPlatformShortcutModifier(event) && event.shiftKey && event.code === "KeyT";
}

function paneFocusShortcutDirection(event: KeyboardEvent): PaneFocusDirection | null {
  if (!isPlatformShortcutModifier(event)) {
    return null;
  }
  if (event.code === "KeyH") {
    return "left";
  }
  if (event.code === "KeyJ") {
    return "down";
  }
  if (event.code === "KeyK") {
    return "up";
  }
  if (event.code === "KeyL") {
    return "right";
  }
  return null;
}

function paneCycleShortcutStep(event: KeyboardEvent) {
  if (!isPlatformShortcutModifier(event) || event.key !== "Tab") {
    return 0;
  }
  return event.shiftKey ? -1 : 1;
}

function splitShortcutDirection(event: KeyboardEvent): SplitDirection | null {
  if (!isPlatformShortcutModifier(event) || !event.shiftKey) {
    return null;
  }
  if (event.code === "KeyV") {
    return "down";
  }
  if (event.code === "Minus") {
    return "right";
  }
  return null;
}

function isPlatformShortcutModifier(event: KeyboardEvent) {
  return !event.ctrlKey && event.metaKey !== event.altKey;
}

function activeShortcutTab(
  snapshot: Snapshot,
  activeSpace: WorkspaceInfo | null,
  selectedPane: PaneInfo | null,
): TabInfo | null {
  const tabId =
    selectedPane && selectedPane.workspace_id === activeSpace?.workspace_id
      ? selectedPane.tab_id
      : activeSpace?.active_tab_id;
  if (!tabId) {
    return null;
  }
  return snapshot.tabs.find((tab) => tab.tab_id === tabId) ?? null;
}

function isShortcutTextEntryTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.classList.contains("ghostty-hidden-input")) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  return target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement;
}

function hasOpenModal() {
  return document.querySelector(".overlay-root [role='dialog']") !== null;
}

function SplitGrid({
  cells,
  selectedPaneId,
  onSelectPane,
  refitToken,
  focusToken,
  touchInput,
  mobileTapTarget,
  mobileTouchSelection,
  connectionKey,
  resumeToken,
  httpUrl,
  wsUrl,
}: {
  cells: { pane: PaneInfo; style: CSSProperties }[];
  selectedPaneId: string | null;
  onSelectPane: (pane: PaneInfo) => void;
  refitToken: number;
  focusToken: number;
  touchInput: boolean;
  mobileTapTarget: MobileTerminalTapTarget;
  mobileTouchSelection: boolean;
  connectionKey: string;
  resumeToken: number;
  httpUrl: (path: string, query?: URLSearchParams) => string;
  wsUrl: (path: string, query?: URLSearchParams) => string;
}) {
  return (
    <div className="pane-grid" aria-label="Split panes">
      {cells.map(({ pane, style }) => {
        const selected = pane.pane_id === selectedPaneId;
        return (
          <div
            key={pane.pane_id}
            className="pane-cell"
            data-selected={selected}
            style={style}
            onPointerDown={() => onSelectPane(pane)}
          >
            <TerminalView
              pane={pane}
              connectionKey={connectionKey}
              resumeToken={resumeToken}
              httpUrl={httpUrl}
              wsUrl={wsUrl}
              autoFocus={selected && !touchInput}
              scrollSensitivity={touchInput ? 2 : 0.4}
              mobileControls={selected && touchInput}
              mobileTapTarget={mobileTapTarget}
              mobileTouchSelection={mobileTouchSelection}
              refitToken={selected ? refitToken : 0}
              focusToken={selected ? focusToken : 0}
            />
          </div>
        );
      })}
    </div>
  );
}

function TabBar({
  snapshot,
  activeSpace,
  selectedPane,
  onSelectTab,
  onCreateTab,
  onMenu,
}: {
  snapshot: Snapshot | null;
  activeSpace: WorkspaceInfo | null;
  selectedPane: PaneInfo | null;
  onSelectTab: (tabId: string) => void;
  onCreateTab: (workspaceId: string) => void;
  onMenu: (
    kind: MenuKind,
    id: string,
    label: string,
    x: number,
    y: number,
    clearable?: boolean,
  ) => void;
}) {
  if (!snapshot || !activeSpace) {
    return null;
  }
  const tabs = sortTabsForWorkspace(snapshot.tabs, activeSpace.workspace_id);
  if (tabs.length === 0) {
    return null;
  }
  const activeTabId =
    selectedPane && selectedPane.workspace_id === activeSpace.workspace_id
      ? selectedPane.tab_id
      : activeSpace.active_tab_id;
  return (
    <div className="tabbar" role="tablist" aria-label="Tabs">
      {tabs.map((tab) => {
        const label = displayTabLabel(tab, snapshot.panes);
        return (
          <button
            key={tab.tab_id}
            type="button"
            className="tabbar-tab"
            role="tab"
            aria-selected={tab.tab_id === activeTabId}
            data-active={tab.tab_id === activeTabId}
            onClick={() => onSelectTab(tab.tab_id)}
            onContextMenu={(event) => {
              event.preventDefault();
              onMenu("tab", tab.tab_id, label, event.clientX, event.clientY, canClearTabName(tab));
            }}
          >
            <span className="dot" data-status={tab.agent_status} />
            <span className="tabbar-name">{label}</span>
          </button>
        );
      })}
      <button
        className="tabbar-add"
        type="button"
        aria-label="New tab"
        title="New tab"
        onClick={() => onCreateTab(activeSpace.workspace_id)}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

function Switcher({
  snapshot,
  loadState,
  bridgeCanConnect,
  bridgeError,
  bridgeLabel,
  bridgeMode,
  capabilityState,
  scope,
  sidebarView,
  agentSort,
  agentGroup,
  activeSpace,
  selectedPane,
  onScope,
  onSidebarView,
  onAgentSort,
  onAgentGroup,
  onSelectSpace,
  onSelectTab,
  onSelectPane,
  onRefresh,
  onBackendSettings,
  onCreateSpace,
  onCreateTab,
  onMenu,
}: {
  snapshot: Snapshot | null;
  loadState: LoadState;
  bridgeCanConnect: boolean;
  bridgeError: string | null;
  bridgeLabel: string;
  bridgeMode: "same-origin" | "configured" | "disconnected";
  capabilityState: "idle" | "probing" | "ready" | "error";
  scope: Scope;
  sidebarView: SidebarView;
  agentSort: AgentSort;
  agentGroup: AgentGroup;
  activeSpace: WorkspaceInfo | null;
  selectedPane: PaneInfo | null;
  onScope: (scope: Scope) => void;
  onSidebarView: (view: SidebarView) => void;
  onAgentSort: (sort: AgentSort) => void;
  onAgentGroup: (group: AgentGroup) => void;
  onSelectSpace: (workspaceId: string) => void;
  onSelectTab: (tabId: string) => void;
  onSelectPane: (pane: PaneInfo) => void;
  onRefresh: () => void;
  onBackendSettings: () => void;
  onCreateSpace: () => void;
  onCreateTab: (workspaceId: string) => void;
  onMenu: (
    kind: MenuKind,
    id: string,
    label: string,
    x: number,
    y: number,
    clearable?: boolean,
  ) => void;
}) {
  const panes = snapshot?.panes ?? [];
  const roll = aggregateStatus(panes);
  const headerSummary = summary(panes);
  const bridgeBlocked = !bridgeCanConnect;

  const agentPanes = useMemo(() => {
    if (!snapshot) {
      return [];
    }
    const scoped =
      scope === "all"
        ? snapshot.panes
        : snapshot.panes.filter((pane) => pane.workspace_id === activeSpace?.workspace_id);
    return sortAgentPanes(scoped.filter(isAgentPane), agentSort, snapshot);
  }, [snapshot, scope, activeSpace?.workspace_id, agentSort]);

  const agentGroups = useMemo(() => {
    if (!snapshot || agentGroup !== "workspace") {
      return [];
    }
    const paneBuckets = new Map<string, PaneInfo[]>();
    for (const pane of agentPanes) {
      const panesForWorkspace = paneBuckets.get(pane.workspace_id) ?? [];
      panesForWorkspace.push(pane);
      paneBuckets.set(pane.workspace_id, panesForWorkspace);
    }
    return snapshot.workspaces
      .filter((workspace) => paneBuckets.has(workspace.workspace_id))
      .map((workspace) => ({
        workspace,
        panes: paneBuckets.get(workspace.workspace_id) ?? [],
      }));
  }, [snapshot, agentGroup, agentPanes]);

  const spaceGroups = useMemo(() => {
    if (!snapshot) {
      return [];
    }
    const spaces =
      scope === "all"
        ? snapshot.workspaces
        : snapshot.workspaces.filter(
            (workspace) => workspace.workspace_id === activeSpace?.workspace_id,
          );
    return spaces.map((workspace) => ({
      workspace,
      tabs: sortTabsForWorkspace(snapshot.tabs, workspace.workspace_id)
        .map((tab) => ({ tab, panes: sortPanesForTab(snapshot.panes, tab.tab_id) }))
        .filter((group) => group.panes.length > 0),
    }));
  }, [snapshot, scope, activeSpace?.workspace_id]);

  let agentPaneIndex = 0;
  let paneIndex = 0;

  return (
    <>
      <header className="sb-head">
        <div className="brand">
          <span className="brand-mark">
            <img className="brand-logo" src="/herdr-logo.svg" alt="" aria-hidden="true" />
            <span className="brand-title">
              <span className="brand-dot dot" data-status={roll} />
              herdr-web
            </span>
          </span>
          {headerSummary ? (
            <span className="brand-sub">
              <b>{headerSummary}</b>
            </span>
          ) : bridgeMode === "configured" ? (
            <span className="brand-sub">{bridgeLabel}</span>
          ) : null}
        </div>
        <button
          className="icon-btn"
          type="button"
          aria-label="Settings"
          title={`Settings; bridge: ${bridgeLabel}`}
          data-spin={capabilityState === "probing" ? "" : undefined}
          onClick={onBackendSettings}
        >
          <Settings size={16} />
        </button>
        <button
          className="icon-btn"
          type="button"
          aria-label="Refresh"
          title="Refresh"
          data-spin={loadState === "loading" ? "" : undefined}
          onClick={onRefresh}
        >
          <RefreshCw size={16} />
        </button>
      </header>

      <div className="sidebar-mode" role="group" aria-label="Sidebar view">
        <button
          type="button"
          data-on={sidebarView === "agents"}
          aria-pressed={sidebarView === "agents"}
          onClick={() => onSidebarView("agents")}
        >
          Agents
        </button>
        <button
          type="button"
          data-on={sidebarView === "tabs"}
          aria-pressed={sidebarView === "tabs"}
          onClick={() => onSidebarView("tabs")}
        >
          Tabs
        </button>
      </div>
      <div className="sidebar-scope" role="group" aria-label="Sidebar scope">
        <button
          type="button"
          data-on={scope === "space"}
          aria-pressed={scope === "space"}
          onClick={() => onScope("space")}
        >
          space
        </button>
        <button
          type="button"
          data-on={scope === "all"}
          aria-pressed={scope === "all"}
          onClick={() => onScope("all")}
        >
          all
        </button>
      </div>

      <div className="list">
        {!snapshot ? (
          <div className="empty">
            <strong>
              {bridgeBlocked
                ? "Bridge disconnected"
                : loadState === "error"
                  ? "Bridge unavailable"
                  : "Connecting…"}
            </strong>
            <span>
              {bridgeBlocked
                ? bridgeError || "Choose a usable bridge backend."
                : loadState === "error"
                  ? "Could not reach the herdr bridge."
                  : ""}
            </span>
            {bridgeBlocked ? (
              <button type="button" className="btn" onClick={onBackendSettings}>
                Settings
              </button>
            ) : null}
          </div>
        ) : (
          <>
            {/* SPACES ---------------------------------------------------- */}
            {scope === "space" ? (
            <section className="sec">
              <div className="sec-head">
                <span className="sec-label">spaces</span>
                <span className="sec-rule" />
                <span className="sec-count mono">{snapshot.workspaces.length}</span>
                <button
                  className="sec-add"
                  type="button"
                  aria-label="New space"
                  title="New space"
                  onClick={onCreateSpace}
                >
                  <Plus size={14} />
                </button>
              </div>
              {snapshot.workspaces.length === 0 ? (
                <div className="empty">
                  <strong>No spaces yet</strong>
                  <span>Tap + to create one.</span>
                </div>
              ) : (
                snapshot.workspaces.map((workspace, index) => (
                  <SpaceRow
                    key={workspace.workspace_id}
                    index={index}
                    workspace={workspace}
                    active={workspace.workspace_id === activeSpace?.workspace_id}
                    attention={countAttention(
                      snapshot.panes.filter((pane) => pane.workspace_id === workspace.workspace_id),
                    )}
                    onSelect={() => onSelectSpace(workspace.workspace_id)}
                    onMenu={(x, y) =>
                      onMenu(
                        "space",
                        workspace.workspace_id,
                        workspace.label,
                        x,
                        y,
                        canClearWorkspaceName(workspace, snapshot.panes),
                      )
                    }
                  />
                ))
              )}
            </section>
            ) : null}

            {/* PANES ----------------------------------------------------- */}
            {snapshot.workspaces.length > 0 ? (
            <section className="sec">
              <div className="sec-head">
                <span className="sec-label">
                  {sidebarView === "agents"
                    ? scope === "all"
                      ? "all agents"
                      : "space agents"
                    : scope === "all"
                      ? "all tabs"
                      : (activeSpace?.label ?? "tabs")}
                </span>
                <span className="sec-rule" />
                {sidebarView === "agents" ? (
                  <div className="agent-list-controls">
                    <label className="sort-control">
                      <span>sort</span>
                      <select
                        value={agentSort}
                        onChange={(event) => onAgentSort(event.currentTarget.value as AgentSort)}
                      >
                        <option value="attention">attention</option>
                        <option value="status">status</option>
                        <option value="workspace">workspace</option>
                      </select>
                    </label>
                    <label className="sort-control">
                      <span>group</span>
                      <select
                        value={agentGroup}
                        onChange={(event) => onAgentGroup(event.currentTarget.value as AgentGroup)}
                      >
                        <option value="none">none</option>
                        <option value="workspace">workspace</option>
                      </select>
                    </label>
                  </div>
                ) : scope === "space" && activeSpace ? (
                  <button
                    className="sec-add"
                    type="button"
                    aria-label="New tab"
                    title="New tab"
                    onClick={() => onCreateTab(activeSpace.workspace_id)}
                  >
                    <Plus size={14} />
                  </button>
                ) : null}
              </div>

              {sidebarView === "agents" ? (
                agentPanes.length === 0 ? (
                  <div className="empty">
                    <strong>No detected agents</strong>
                    <span>Open the Tabs view for plain panes.</span>
                  </div>
                ) : agentGroup === "workspace" ? (
                  agentGroups.map((group) => (
                    <Fragment key={group.workspace.workspace_id}>
                      <div className="grp-space">
                        <span className="dot" data-status={group.workspace.agent_status} />
                        <span className="grp-space-name">{group.workspace.label}</span>
                        <span className="grp-space-line" />
                      </div>
                      {group.panes.map((pane) => {
                        const tab = snapshot.tabs.find((item) => item.tab_id === pane.tab_id);
                        return (
                          <AgentRow
                            key={pane.pane_id}
                            index={agentPaneIndex++}
                            pane={pane}
                            workspace={group.workspace}
                            tabLabel={tab ? displayTabLabel(tab, snapshot.panes) : undefined}
                            active={pane.pane_id === selectedPane?.pane_id}
                            onSelect={() => onSelectPane(pane)}
                            onMenu={(x, y) => onMenu("pane", pane.pane_id, paneTitle(pane), x, y)}
                          />
                        );
                      })}
                    </Fragment>
                  ))
                ) : (
                  agentPanes.map((pane, index) => {
                    const tab = snapshot.tabs.find((item) => item.tab_id === pane.tab_id);
                    return (
                      <AgentRow
                        key={pane.pane_id}
                        index={index}
                        pane={pane}
                        workspace={snapshot.workspaces.find(
                          (workspace) => workspace.workspace_id === pane.workspace_id,
                        )}
                        tabLabel={tab ? displayTabLabel(tab, snapshot.panes) : undefined}
                        active={pane.pane_id === selectedPane?.pane_id}
                        onSelect={() => onSelectPane(pane)}
                        onMenu={(x, y) => onMenu("pane", pane.pane_id, paneTitle(pane), x, y)}
                      />
                    );
                  })
                )
              ) : spaceGroups.every((group) => group.tabs.length === 0) ? (
                <div className="empty">
                  <strong>No panes</strong>
                  <span>This space has no panes yet.</span>
                </div>
              ) : (
                spaceGroups.map((group) => (
                  <Fragment key={group.workspace.workspace_id}>
                    {scope === "all" ? (
                      <div className="grp-space">
                        <span className="dot" data-status={group.workspace.agent_status} />
                        <span className="grp-space-name">{group.workspace.label}</span>
                        <span className="grp-space-line" />
                      </div>
                    ) : null}
                    {group.tabs.map(({ tab, panes: tabPanes }) => {
                      const label = displayTabLabel(tab, snapshot.panes);
                      return (
                        <div className="tabgrp" key={tab.tab_id}>
                          {group.workspace.tab_count > 1 || tabPanes.length > 1 ? (
                            <TabDivider
                              label={label}
                              count={tabPanes.length}
                              onSelect={() => onSelectTab(tab.tab_id)}
                              onMenu={(x, y) =>
                                onMenu("tab", tab.tab_id, label, x, y, canClearTabName(tab))
                              }
                            />
                          ) : null}
                          {tabPanes.map((pane) => (
                            <PaneRow
                              key={pane.pane_id}
                              index={paneIndex++}
                              pane={pane}
                              active={pane.pane_id === selectedPane?.pane_id}
                              onSelect={() => onSelectPane(pane)}
                              onMenu={(x, y) => onMenu("pane", pane.pane_id, paneTitle(pane), x, y)}
                            />
                          ))}
                        </div>
                      );
                    })}
                  </Fragment>
                ))
              )}
            </section>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

function SpaceRow({
  workspace,
  active,
  attention,
  index,
  onSelect,
  onMenu,
}: {
  workspace: WorkspaceInfo;
  active: boolean;
  attention: number;
  index: number;
  onSelect: () => void;
  onMenu: (x: number, y: number) => void;
}) {
  const press = useLongPress(onMenu, onSelect);
  return (
    <button
      className="space-row"
      type="button"
      data-active={active}
      style={{ animationDelay: `${Math.min(index, 14) * 22}ms` }}
      {...press}
    >
      <span className="dot" data-status={workspace.agent_status} />
      <span className="space-body">
        <span className="space-name">{workspace.label}</span>
        <span className="space-sub mono">{spaceSubtitle(workspace)}</span>
      </span>
      {attention > 0 ? <span className="attn">{attention}</span> : null}
    </button>
  );
}

function TabDivider({
  label,
  count,
  onSelect,
  onMenu,
}: {
  label: string;
  count: number;
  onSelect: () => void;
  onMenu: (x: number, y: number) => void;
}) {
  const press = useLongPress(onMenu, onSelect);
  return (
    <div className="tab-div">
      <button type="button" className="tab-head" {...press}>
        <span className="tab-name">{label}</span>
        {count > 1 ? (
          <span className="tab-split mono">
            <SplitGlyph />
            {count}
          </span>
        ) : null}
      </button>
      <span className="tab-line" />
    </div>
  );
}

function PaneRow({
  pane,
  active,
  index,
  onSelect,
  onMenu,
}: {
  pane: PaneInfo;
  active: boolean;
  index: number;
  onSelect: () => void;
  onMenu: (x: number, y: number) => void;
}) {
  const press = useLongPress(onMenu, onSelect);
  const meta = paneMeta(pane);
  return (
    <button
      className="pane-row"
      type="button"
      data-active={active}
      data-status={pane.agent_status}
      style={{ animationDelay: `${Math.min(index, 14) * 22}ms` }}
      {...press}
    >
      <span className="dot" data-status={pane.agent_status} />
      <span className="pane-body">
        <span className="pane-name">{paneTitle(pane)}</span>
        {meta ? <span className="pane-meta mono">{meta}</span> : null}
      </span>
      {isLoud(pane.agent_status) ? (
        <span className="pane-word" data-status={pane.agent_status}>
          {statusLabel(pane.agent_status)}
        </span>
      ) : null}
    </button>
  );
}

function AgentRow({
  pane,
  workspace,
  tabLabel,
  active,
  index,
  onSelect,
  onMenu,
}: {
  pane: PaneInfo;
  workspace?: WorkspaceInfo;
  tabLabel?: string;
  active: boolean;
  index: number;
  onSelect: () => void;
  onMenu: (x: number, y: number) => void;
}) {
  const press = useLongPress(onMenu, onSelect);
  const iconKind = agentIconKind(pane);
  return (
    <button
      className="pane-row agent-row"
      type="button"
      data-active={active}
      data-status={pane.agent_status}
      style={{ animationDelay: `${Math.min(index, 14) * 22}ms` }}
      {...press}
    >
      <span className="dot" data-status={pane.agent_status} />
      <span className="pane-body">
        <span className="pane-name agent-title">
          {iconKind ? <AgentIcon kind={iconKind} /> : null}
          <span className="agent-title-text">{agentTitle(pane)}</span>
        </span>
        <span className="pane-meta mono">{agentSubtitle(pane, workspace, tabLabel)}</span>
      </span>
      {isLoud(pane.agent_status) ? (
        <span className="pane-word" data-status={pane.agent_status}>
          {statusLabel(pane.agent_status)}
        </span>
      ) : null}
    </button>
  );
}

function StatusBadge({ status }: { status: AgentStatus }) {
  return (
    <span className="badge" data-status={status}>
      <span className="dot" data-status={status} />
      {statusLabel(status)}
    </span>
  );
}

function isAgentPane(pane: PaneInfo) {
  return Boolean(
    pane.agent ||
      pane.display_agent ||
      pane.custom_status ||
      pane.title ||
      pane.agent_status !== "unknown",
  );
}

function sortAgentPanes(panes: PaneInfo[], sort: AgentSort, snapshot: Snapshot) {
  const workspaceNumber = new Map(
    snapshot.workspaces.map((workspace) => [workspace.workspace_id, workspace.number]),
  );
  const tabNumber = new Map(snapshot.tabs.map((tab) => [tab.tab_id, tab.number]));
  const statusOrder: Record<AgentStatus, number> = {
    blocked: 0,
    working: 1,
    done: 2,
    idle: 3,
    unknown: 4,
  };
  const attentionOrder: Record<AgentStatus, number> = {
    blocked: 0,
    done: 1,
    working: 2,
    idle: 3,
    unknown: 4,
  };

  return [...panes].sort((a, b) => {
    if (sort === "attention") {
      const attention = Number(isAttention(b.agent_status)) - Number(isAttention(a.agent_status));
      if (attention !== 0) {
        return attention;
      }
      const status = attentionOrder[a.agent_status] - attentionOrder[b.agent_status];
      if (status !== 0) {
        return status;
      }
    } else if (sort === "status") {
      const status = statusOrder[a.agent_status] - statusOrder[b.agent_status];
      if (status !== 0) {
        return status;
      }
    }

    const workspace =
      (workspaceNumber.get(a.workspace_id) ?? Number.MAX_SAFE_INTEGER) -
      (workspaceNumber.get(b.workspace_id) ?? Number.MAX_SAFE_INTEGER);
    if (workspace !== 0) {
      return workspace;
    }
    const tab =
      (tabNumber.get(a.tab_id) ?? Number.MAX_SAFE_INTEGER) -
      (tabNumber.get(b.tab_id) ?? Number.MAX_SAFE_INTEGER);
    if (tab !== 0) {
      return tab;
    }
    return a.pane_id.localeCompare(b.pane_id, undefined, { numeric: true });
  });
}

function agentTitle(pane: PaneInfo) {
  return pane.display_agent || pane.label || pane.agent || pane.title || paneTitle(pane);
}

function agentSubtitle(pane: PaneInfo, workspace?: WorkspaceInfo, tabLabel?: string) {
  const stateText =
    pane.custom_status ||
    pane.state_labels?.[statusLabel(pane.agent_status)] ||
    statusLabel(pane.agent_status);
  const dir = basename(pane.foreground_cwd || pane.cwd);
  return [stateText, workspace?.label, tabLabel, dir].filter(Boolean).join(" · ");
}

function basename(path?: string) {
  if (!path) {
    return "";
  }
  const trimmed = path.replace(/\/+$/, "");
  if (!trimmed) {
    return "";
  }
  return trimmed.split("/").pop() ?? "";
}

function SplitGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <rect
        x="0.75"
        y="0.75"
        width="10.5"
        height="10.5"
        rx="1.75"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <line x1="6" y1="1" x2="6" y2="11" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function menuItems(kind: MenuKind, paneMoveSupported: boolean): MenuItem[] {
  if (kind === "space") {
    return [
      { key: "rename", label: "Rename" },
      { key: "newtab", label: "New tab" },
      { key: "close", label: "Close space", danger: true },
    ];
  }
  if (kind === "tab") {
    return [
      { key: "rename", label: "Rename" },
      { key: "close", label: "Close tab", danger: true },
    ];
  }
  const paneItems: MenuItem[] = [
    { key: "rename", label: "Rename" },
  ];
  if (paneMoveSupported) {
    paneItems.push(
      { key: "move_new_tab", label: "Move to new tab" },
      { key: "move_new_space", label: "Move to new space" },
    );
  }
  paneItems.push({ key: "close", label: "Close pane", danger: true });
  return paneItems;
}

function closeCopy(kind: MenuKind) {
  switch (kind) {
    case "space":
      return {
        title: "Close space?",
        message: "This closes the space and every tab and pane inside it.",
        confirm: "Close space",
      };
    case "tab":
      return {
        title: "Close tab?",
        message: "This closes the tab and all of its panes.",
        confirm: "Close tab",
      };
    case "pane":
      return {
        title: "Close pane?",
        message: "This ends the pane's terminal session.",
        confirm: "Close pane",
      };
  }
}

function useIsCompactLayout() {
  const [compact, setCompact] = useState(() => isCompactLayoutViewport());
  useEffect(() => {
    const mq = window.matchMedia(COMPACT_LAYOUT_QUERY);
    const update = () => setCompact(isCompactLayoutViewport());
    update();
    mq.addEventListener("change", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      mq.removeEventListener("change", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);
  return compact;
}

function isCompactLayoutViewport() {
  if (typeof window === "undefined") {
    return false;
  }
  return window.matchMedia(COMPACT_LAYOUT_QUERY).matches || window.innerWidth <= 820;
}

function useIsTouchInput() {
  const [touchInput, setTouchInput] = useState(() => isTouchInputViewport());
  useEffect(() => {
    const mq = window.matchMedia(TOUCH_INPUT_QUERY);
    const update = () => setTouchInput(isTouchInputViewport());
    update();
    mq.addEventListener("change", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      mq.removeEventListener("change", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);
  return touchInput;
}

function isTouchInputViewport() {
  if (typeof window === "undefined") {
    return false;
  }
  return window.matchMedia(TOUCH_INPUT_QUERY).matches || navigator.maxTouchPoints > 0;
}

function summary(panes: PaneInfo[]) {
  const blocked = panes.filter((pane) => pane.agent_status === "blocked").length;
  const done = panes.filter((pane) => pane.agent_status === "done").length;
  const working = panes.filter((pane) => pane.agent_status === "working").length;
  return blocked
    ? `${blocked} blocked`
    : done
      ? `${done} done`
      : working
        ? `${working} working`
        : null;
}

function stageBreadcrumb(
  snapshot: Snapshot | null,
  pane: PaneInfo | null,
  loadState: LoadState,
  bridgeCanConnect: boolean,
) {
  if (!pane) {
    if (!bridgeCanConnect) {
      return "bridge disconnected";
    }
    if (loadState === "error") {
      return "bridge unavailable";
    }
    return snapshot ? "no pane selected" : "connecting…";
  }
  const workspace = snapshot?.workspaces.find((item) => item.workspace_id === pane.workspace_id);
  const tab = snapshot?.tabs.find((item) => item.tab_id === pane.tab_id);
  const tabLabel = tab && snapshot ? displayTabLabel(tab, snapshot.panes) : undefined;
  return [workspace?.label, tabLabel].filter(Boolean).join(" · ") || pane.pane_id;
}

async function fetchSnapshot(httpUrl: (path: string, query?: URLSearchParams) => string) {
  const response = await fetch(httpUrl("/api/snapshot"));
  if (!response.ok) {
    throw new Error(`snapshot failed: ${response.status}`);
  }
  return (await response.json()) as Snapshot;
}

async function syncSelectedPane(
  httpUrl: (path: string, query?: URLSearchParams) => string,
  paneId: string,
) {
  const response = await fetch(httpUrl("/api/selection"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pane_id: paneId }),
  });
  if (!response.ok) {
    throw new Error(`selection failed: ${response.status}`);
  }
}

async function refreshSnapshot(
  httpUrl: (path: string, query?: URLSearchParams) => string,
  setSnapshot: (snapshot: Snapshot) => void,
  setLoadState: (state: LoadState) => void,
  isDisposed: () => boolean,
) {
  try {
    const next = await fetchSnapshot(httpUrl);
    if (!isDisposed()) {
      setSnapshot(next);
      setLoadState("ready");
    }
  } catch {
    if (!isDisposed()) {
      setLoadState("error");
    }
  }
}

function selectionPaneId(event: MessageEvent) {
  if (typeof event.data !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(event.data) as { type?: unknown; pane_id?: unknown };
    return parsed.type === "herdr_web.selection_changed" && typeof parsed.pane_id === "string"
      ? parsed.pane_id
      : null;
  } catch {
    return null;
  }
}

function blurActiveTextInput() {
  const element = document.activeElement;
  if (!(element instanceof HTMLElement)) {
    return;
  }
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    element.isContentEditable
  ) {
    element.blur();
  }
}

function openEventsSocket(
  wsUrl: (path: string, query?: URLSearchParams) => string,
  path: string,
  onEvent: (event: MessageEvent) => void,
) {
  const url = wsUrl(path);
  let socket: WebSocket | null = null;
  let closed = false;
  let reconnectTimer: number | null = null;
  let attempts = 0;

  const connect = () => {
    if (closed) {
      return;
    }
    const next = new WebSocket(url);
    socket = next;
    next.addEventListener("open", () => {
      attempts = 0;
    });
    next.addEventListener("message", onEvent);
    next.addEventListener("close", () => {
      if (closed || socket !== next || reconnectTimer !== null) {
        return;
      }
      const delay = Math.min(500 * 2 ** attempts, 5000);
      attempts += 1;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    });
  };

  connect();
  return {
    close() {
      closed = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      socket?.close();
    },
  };
}
