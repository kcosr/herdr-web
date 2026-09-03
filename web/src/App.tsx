import {
  Activity,
  Archive,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Link2,
  ListCollapse,
  ListRestart,
  Moon,
  MoreVertical,
  PanelLeft,
  Pin,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  SplitSquareHorizontal,
  SplitSquareVertical,
  SquareTerminal,
  StickyNote,
  Sun,
  Trash2,
  Unlink,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  Fragment,
  Suspense,
  lazy,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  CSSProperties,
  Dispatch,
  FormEvent as ReactFormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  SetStateAction,
} from "react";
import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { AgentIcon, agentIconKind } from "./AgentIcon";
import {
  agentActivityKey,
  agentActivityTimestamps,
  fetchAgentActivity,
  supportsAgentActivity,
} from "./agentActivity";
import type { AgentActivityListResponse } from "./agentActivity";
import {
  agentPinKey,
  agentPinKeys,
  fetchAgentPins,
  pinAgent,
  supportsAgentPins,
  unpinAgent,
} from "./agentPins";
import type { AgentPinsListResponse } from "./agentPins";
import { applyActivityMessage, parseActivityEventData, replayActivityMessages } from "./activity";
import type { ActivityLogEntry } from "./activity";
import { BackendSettingsDialog } from "./BackendSettingsDialog";
import { useBridge } from "./bridge";
import type { BridgeId, BridgeRuntime } from "./bridge";
import { createCommands, createdPaneId } from "./commands";
import type { LaunchSpec, PaneFocusDirection, SplitDirection } from "./commands";
import { isConnectionResultCurrent } from "./connectionState";
import {
  DEFAULT_CONTENT_INSET_BOTTOM_PX,
  DEFAULT_CONTENT_INSET_TOP_PX,
  DEFAULT_MOBILE_CONTROLS_SCALE_PERCENT,
  DEFAULT_AGENT_FEATURES_IN_TABS,
  DEFAULT_MULTI_HOST_SPACE_SELECTION,
  parseContentInsetBottomPx,
  parseContentInsetTopPx,
  parseMobileControlsScalePercent,
  parseAgentFeaturesInTabs,
  parseMultiHostSpaceSelection,
} from "./displayPrefs";
import { LaunchDialog } from "./LaunchDialog";
import { resolveLaunchSpec } from "./launch";
import type { LaunchTarget } from "./launch";
import { PaneSearchDialog } from "./PaneSearchDialog";
import { useTalkBack } from "./useTalkBack";
import type { PaneSearchEntry } from "./paneSearch";
import { fetchLauncherPresets, supportsLauncherPresets } from "./launcherPresets";
import type { LauncherPresetsResponse } from "./launcherPresets";
import { fetchWithTimeout } from "./fetchWithTimeout";
import {
  DEFAULT_MOBILE_COMMAND_ENTER_NEWLINE,
  DEFAULT_MOBILE_COMMAND_EXPANDING_INPUT,
  DEFAULT_MOBILE_COMPACT_CONTROLS,
  DEFAULT_MOBILE_KEYBOARD_HIDE_REFIT,
  DEFAULT_MOBILE_LONG_PRESS_BEHAVIOR,
  DEFAULT_MOBILE_TOUCH_SELECTION_ENDPOINT_TIMEOUT_MS,
  DEFAULT_MOBILE_TERMINAL_TAP_TARGET,
  parseMobileCommandEnterNewline,
  parseMobileCommandExpandingInput,
  parseMobileCompactControls,
  parseMobileKeyboardHideRefit,
  parseMobileLongPressBehavior,
  parseMobileTouchSelectionEndpointTimeoutMs,
  parseMobileTerminalTapTarget,
} from "./mobileTerminalPrefs";
import type {
  MobileLongPressBehavior,
  MobileTerminalTapTarget,
  MobileTouchSelectionEndpointTimeoutMs,
} from "./mobileTerminalPrefs";
import { addNativeBackHandler, addNativeKeyboardHideHandler, isNativeAndroid } from "./native";
import {
  archiveNote,
  attachNote,
  compareNotes,
  createNote,
  deleteNote,
  detachNote,
  fetchNotes,
  isNotesConflictError,
  notesForPane,
  restoreNote,
  supportsNotes,
  updateNote,
} from "./notes";
import type { NoteAttachment, NotesListResponse, PaneNote } from "./notes";
import {
  NAVIGATION_SYNC_MODE_KEY,
  navigationSyncModeForStorageEvent,
  parseNavigationSyncMode,
  readNavigationSyncMode,
  sharesNavigation,
  writeNavigationSyncMode,
} from "./navigationPrefs";
import type { NavigationSyncMode } from "./navigationPrefs";
import { ActionMenu, ConfirmDialog, RenameDialog, useLongPress } from "./overlays";
import type { MenuItem } from "./overlays";
import {
  focusableElements,
  focusOverlayTrigger,
  trapFocusWithin,
  useFocusReturn,
} from "./overlayFocus";
import { createSnapshotRefreshController } from "./refreshCoordinator";
import { TerminalView } from "./TerminalView";
import {
  DEFAULT_TERMINAL_SCREEN_READER_TEXT,
  parseTerminalScreenReaderText,
} from "./terminalAccessibleText";
import {
  DEFAULT_TERMINAL_INPUT_BATCH_DELAY_MS,
  DEFAULT_TERMINAL_INPUT_TRANSPORT,
  parseTerminalInputBatchDelayMs,
  parseTerminalInputTransport,
} from "./terminalInputTransport";
import type { TerminalInputTransport } from "./terminalInputTransport";
import {
  DEFAULT_TERMINAL_OUTPUT_COALESCE_MS,
  parseTerminalOutputCoalesceMs,
} from "./terminalOutputCoalescing";
import {
  DEFAULT_TERMINAL_FONT_SIZE_PX,
  parseTerminalFontSizePx,
} from "./terminalPrefs";
import { applyTheme, DEFAULT_THEME, nextTheme, parseTheme } from "./theme";
import type { Theme } from "./theme";
import {
  aggregateStatus,
  basename,
  canClearTabName,
  canClearWorkspaceName,
  chooseDirectionalPane,
  choosePaneForTab,
  choosePaneForWorkspace,
  chooseSelectedPane,
  chooseSelectedPaneForActiveWorkspace,
  countAttention,
  displayTabLabel,
  isLoud,
  paneMeta,
  paneListSubtitle,
  paneTitle,
  sortPanesForTab,
  sortTabsForWorkspace,
  spaceSubtitle,
  statusLabel,
} from "./state";
import type {
  AgentStatus,
  PaneInfo,
  Snapshot,
  TabInfo,
  WorkspaceInfo,
} from "./types";
import {
  workspaceMoveBlockParams,
  workspaceReorderBlockIds,
  workspaceReorderDestination,
  workspaceReorderRoots,
} from "./workspaceReorder";
import type { WorkspaceReorderDirection } from "./workspaceReorder";

const NoteMarkdownPreview = lazy(() => import("./NoteMarkdownPreview"));

type LoadState = "loading" | "ready" | "error";
type Scope = "space" | "all";
type HostScope = "selected" | "all";
type SidebarView = "agents" | "tabs" | "notes";
type AgentSort = "attention" | "status" | "workspace" | "lastStatusChange";
type AgentGroup = "none" | "host" | "workspace" | "hostWorkspace";
type SpaceGroup = "none" | "host";
type MenuKind = "space" | "tab" | "pane";
type ScopedPaneRef = {
  bridgeId: BridgeId;
  paneId: string;
};
type ScopedNoteRef = {
  bridgeId: BridgeId;
  noteId: string;
};
type ScopedNoteTitleFocusRequest = ScopedNoteRef & {
  token: number;
};
type MobileNotesScreen = "list" | "editor";
type ScopedWorkspaceRef = {
  bridgeId: BridgeId;
  workspaceId: string;
};
type SpaceReorderMode = ScopedWorkspaceRef;
const SPACE_REORDER_INSTRUCTIONS_ID = "space-reorder-instructions";
type SpaceDragState = {
  pointerId: number;
  startY: number;
  beforeWorkspaceId: string | null;
  moved: boolean;
};
type ScopedLaunchTarget = LaunchTarget & {
  bridgeId: BridgeId;
};
export type BridgeConnectionView = {
  runtime: BridgeRuntime;
  snapshot: Snapshot | null;
  loadState: LoadState;
};
export type BridgeConnectionState = {
  connectionKey: string;
  snapshot: Snapshot | null;
  loadState: LoadState;
};
type BridgeResourceState<Response> = {
  connectionKey: string;
  response: Response | null;
  loadState: LoadState;
  error: string | null;
};
type BridgeNotesState = BridgeResourceState<NotesListResponse>;
type BridgeLauncherPresetsState = BridgeResourceState<LauncherPresetsResponse>;
type PendingCreatedPaneNoteTarget = {
  note: PaneNote;
  pane: PaneInfo;
};
type PendingCreatedPaneNote = PendingCreatedPaneNoteTarget & {
  connectionKey: string;
};
type QuickPaneNoteTarget = ScopedPaneRef & {
  label: string;
};
type PendingSharedPaneSelection = {
  paneId: string;
  connectionKey: string;
  timeoutId: number;
};

export function launcherEmptyMessage(
  bridgeReady: boolean,
  launcherSupported: boolean,
  state: BridgeLauncherPresetsState | null,
) {
  if (!bridgeReady) {
    return "Bridge is not ready. Close this dialog and reconnect.";
  }
  if (!launcherSupported) {
    return "Launching is unavailable on this bridge. Update the bridge and reconnect.";
  }
  if (state?.loadState === "error") {
    return `Could not load launcher presets: ${state.error ?? "unknown error"}. Close and reopen this dialog to retry.`;
  }
  if (state?.response && state.response.presets.length === 0) {
    return "No launcher presets available. Adjust builtins or add custom presets.";
  }
  if (state?.loadState === "loading" || !state?.response) {
    return "Loading launchers…";
  }
  return null;
}
type BridgeAgentPinsState = BridgeResourceState<AgentPinsListResponse>;
type BridgeAgentActivityState = BridgeResourceState<AgentActivityListResponse>;
export type BridgeConnectionRef = {
  connectionKey: string;
  snapshot: Snapshot | null;
  activityGeneration: number;
  resyncBarrierGeneration: number;
  activityLog: ActivityLogEntry[];
  sharedSelectionOverride: {
    paneId: string;
    expiresAtMs: number;
  } | null;
};
export type ScopedAgentPane = {
  bridgeId: BridgeId;
  bridgeIndex: number;
  bridgeLabel: string;
  bridgeColor: string;
  pane: PaneInfo;
  snapshot: Snapshot;
  workspace?: WorkspaceInfo;
  tabNumber?: number;
  tabLabel?: string;
  pinned?: boolean;
  lastStatusTransitionAt?: number;
};
type ScopedWorkspace = {
  bridgeId: BridgeId;
  bridgeIndex: number;
  bridgeLabel: string;
  bridgeColor: string;
  snapshot: Snapshot;
  workspace: WorkspaceInfo;
};
type ScopedTabWorkspace = ScopedWorkspace & {
  tabs: { tab: TabInfo; panes: PaneInfo[] }[];
};
type CombinedTabWorkspaceGroup = {
  key: string;
  label: string;
  status: AgentStatus;
  workspaces: ScopedTabWorkspace[];
};
export type ScopedTabEntry = ScopedWorkspace & {
  tab: TabInfo;
  panes: PaneInfo[];
};
export type ScopedNoteEntry = {
  bridgeId: BridgeId;
  connectionKey: string;
  storeId: string;
  sessionKey: string;
  bridgeSessionKey: string;
  bridgeIndex: number;
  bridgeLabel: string;
  bridgeColor: string;
  note: PaneNote;
  snapshot: Snapshot | null;
  workspace?: WorkspaceInfo;
  pane?: PaneInfo;
};
type ScopedAgentGroup = {
  key: string;
  bridgeId: BridgeId;
  label: string;
  bridgeColor?: string;
  status?: AgentStatus;
  panes: ScopedAgentPane[];
};
type NoteDraft = {
  title: string;
  body: string;
  baseRevision: number;
  updatedAt: number;
};
type NoteSaveInFlight = {
  noteIdentity: string;
  expectedRevision: number;
  title: string;
  body: string;
};
type NoteEditorMode = "edit" | "preview";
type MenuState = {
  kind: MenuKind;
  bridgeId: BridgeId;
  id: string;
  label: string;
  x: number;
  y: number;
  clearable?: boolean;
  pinLabel?: "agent" | "pane";
};
type DialogState = {
  mode: "rename" | "close";
  kind: MenuKind;
  bridgeId: BridgeId;
  id: string;
  label: string;
  clearable?: boolean;
};
type DisplayPrefs = {
  hostScope: HostScope;
  scope: Scope;
  sidebarView: SidebarView;
  agentSort: AgentSort;
  agentGroup: AgentGroup;
  combineMatchingWorkspaceNames: boolean;
  collapsedSidebarGroups: string[];
  spaceGroup: SpaceGroup;
  agentPinnedOnly: boolean;
  agentActiveOnly: boolean;
  agentFeaturesInTabs: boolean;
  multiHostSpaceSelection: boolean;
  sidebarWidth: number;
  notesPanelWidth: number;
  notesListPaneWidth: number;
  notesListPaneCollapsed: boolean;
  notesEnabled: boolean;
  notesPanelOpen: boolean;
  sidebarOpen: boolean;
  terminalFontSizePx: number;
  terminalScreenReaderText: boolean;
  terminalInputTransport: TerminalInputTransport;
  terminalInputBatchDelayMs: number;
  terminalOutputCoalesceMs: number;
  contentInsetTopPx: number;
  contentInsetBottomPx: number;
  mobileControlsScalePercent: number;
  mobileTerminalTapTarget: MobileTerminalTapTarget;
  mobileLongPressBehavior: MobileLongPressBehavior;
  mobileTouchSelectionEndpointTimeoutMs: MobileTouchSelectionEndpointTimeoutMs;
  mobileKeyboardHideRefit: boolean;
  mobileCommandExpandingInput: boolean;
  mobileCommandEnterNewline: boolean;
  mobileCompactControls: boolean;
  theme: Theme;
};
type SharedNavigationPrefs = {
  selectedBridgeId: BridgeId | null;
  selectedPane: ScopedPaneRef | null;
  activeWorkspace: ScopedWorkspaceRef | null;
  selectedPanesByBridgeId: Record<string, string>;
  activeWorkspacesByBridgeId: Record<string, string>;
};
type LegacyDisplaySelectionPrefs = {
  activeSpaceId: string | null;
  selectedPaneId: string | null;
};
const COMPACT_LAYOUT_QUERY = "(max-width: 820px)";
const TOUCH_INPUT_QUERY = "(hover: none) and (pointer: coarse)";
const SINGLE_PANE_CELL_STYLE: CSSProperties = { left: 0, top: 0, width: "100%", height: "100%" };
const HIDDEN_PANE_CELL_STYLE: CSSProperties = {
  left: 0,
  top: 0,
  width: "100%",
  height: "100%",
  display: "none",
};
const DISPLAY_PREFS_KEY = "herdr.mobileWeb.displayPrefs.v2";
const SHARED_NAVIGATION_PREFS_KEY = "herdr.mobileWeb.sharedNavigation.v1";
const LEGACY_DISPLAY_PREFS_KEY = "herdr.mobileWeb.displayPrefs.v1";
const MOBILE_SIDEBAR_HISTORY_KEY = "herdrWebMobileSidebar";
const MOBILE_DETAIL_HISTORY_KEY = "herdrWebMobileDetail";
const DEFAULT_SIDEBAR_WIDTH = 320;
const MIN_SIDEBAR_WIDTH = 260;
const MAX_SIDEBAR_WIDTH = 560;
const DEFAULT_NOTES_PANEL_WIDTH = 560;
const MIN_NOTES_PANEL_WIDTH = 420;
const MAX_NOTES_PANEL_WIDTH = 840;
const DEFAULT_NOTES_LIST_PANE_WIDTH = 240;
const MIN_NOTES_LIST_PANE_WIDTH = 200;
const MAX_NOTES_LIST_PANE_WIDTH = 420;

function readDisplayPrefs(): DisplayPrefs {
  const fallback: DisplayPrefs = {
    hostScope: "selected",
    scope: "space",
    sidebarView: "agents",
    agentSort: "attention",
    agentGroup: "none",
    combineMatchingWorkspaceNames: false,
    collapsedSidebarGroups: [],
    spaceGroup: "none",
    agentPinnedOnly: false,
    agentActiveOnly: false,
    agentFeaturesInTabs: DEFAULT_AGENT_FEATURES_IN_TABS,
    multiHostSpaceSelection: DEFAULT_MULTI_HOST_SPACE_SELECTION,
    sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
    notesPanelWidth: DEFAULT_NOTES_PANEL_WIDTH,
    notesListPaneWidth: DEFAULT_NOTES_LIST_PANE_WIDTH,
    notesListPaneCollapsed: true,
    notesEnabled: true,
    notesPanelOpen: false,
    sidebarOpen: true,
    terminalFontSizePx: DEFAULT_TERMINAL_FONT_SIZE_PX,
    terminalScreenReaderText: DEFAULT_TERMINAL_SCREEN_READER_TEXT,
    terminalInputTransport: DEFAULT_TERMINAL_INPUT_TRANSPORT,
    terminalInputBatchDelayMs: DEFAULT_TERMINAL_INPUT_BATCH_DELAY_MS,
    terminalOutputCoalesceMs: DEFAULT_TERMINAL_OUTPUT_COALESCE_MS,
    contentInsetTopPx: DEFAULT_CONTENT_INSET_TOP_PX,
    contentInsetBottomPx: DEFAULT_CONTENT_INSET_BOTTOM_PX,
    mobileControlsScalePercent: DEFAULT_MOBILE_CONTROLS_SCALE_PERCENT,
    mobileTerminalTapTarget: DEFAULT_MOBILE_TERMINAL_TAP_TARGET,
    mobileLongPressBehavior: DEFAULT_MOBILE_LONG_PRESS_BEHAVIOR,
    mobileTouchSelectionEndpointTimeoutMs: DEFAULT_MOBILE_TOUCH_SELECTION_ENDPOINT_TIMEOUT_MS,
    mobileKeyboardHideRefit: DEFAULT_MOBILE_KEYBOARD_HIDE_REFIT,
    mobileCommandExpandingInput: DEFAULT_MOBILE_COMMAND_EXPANDING_INPUT,
    mobileCommandEnterNewline: DEFAULT_MOBILE_COMMAND_ENTER_NEWLINE,
    mobileCompactControls: DEFAULT_MOBILE_COMPACT_CONTROLS,
    theme: DEFAULT_THEME,
  };
  try {
    const raw = window.localStorage.getItem(DISPLAY_PREFS_KEY);
    if (!raw) {
      return readLegacyDisplayPrefs(fallback);
    }
    const parsed = JSON.parse(raw) as Partial<DisplayPrefs> & {
      mobileTouchSelection?: unknown;
    };
    return parseDisplayPrefsValue(parsed, fallback);
  } catch {
    return fallback;
  }
}

async function loadDisplayPrefs(): Promise<DisplayPrefs> {
  const localPrefs = readDisplayPrefs();
  if (!isNativeApp()) {
    return localPrefs;
  }
  try {
    const { value } = await Preferences.get({ key: DISPLAY_PREFS_KEY });
    if (value) {
      return parseDisplayPrefsValue(JSON.parse(value) as Partial<DisplayPrefs>, localPrefs);
    }
  } catch {
    // Fall back to browser storage backup.
  }
  return localPrefs;
}

function emptySharedNavigationPrefs(): SharedNavigationPrefs {
  return {
    selectedBridgeId: null,
    selectedPane: null,
    activeWorkspace: null,
    selectedPanesByBridgeId: {},
    activeWorkspacesByBridgeId: {},
  };
}

function parseSharedNavigationPrefs(value: unknown): SharedNavigationPrefs {
  if (!isRecord(value)) {
    return emptySharedNavigationPrefs();
  }
  return {
    selectedBridgeId:
      typeof value.selectedBridgeId === "string" ? value.selectedBridgeId : null,
    selectedPane: parseScopedPaneRef(value.selectedPane),
    activeWorkspace: parseScopedWorkspaceRef(value.activeWorkspace),
    selectedPanesByBridgeId: parseStringRecord(value.selectedPanesByBridgeId),
    activeWorkspacesByBridgeId: parseStringRecord(value.activeWorkspacesByBridgeId),
  };
}

function readSharedNavigationPrefs(): SharedNavigationPrefs {
  try {
    const raw = window.localStorage.getItem(SHARED_NAVIGATION_PREFS_KEY);
    return raw ? parseSharedNavigationPrefs(JSON.parse(raw)) : emptySharedNavigationPrefs();
  } catch {
    return emptySharedNavigationPrefs();
  }
}

async function loadSharedNavigationPrefs(): Promise<SharedNavigationPrefs> {
  const localPrefs = readSharedNavigationPrefs();
  if (!isNativeApp()) {
    return localPrefs;
  }
  try {
    const { value } = await Preferences.get({ key: SHARED_NAVIGATION_PREFS_KEY });
    return value ? parseSharedNavigationPrefs(JSON.parse(value)) : localPrefs;
  } catch {
    return localPrefs;
  }
}

async function loadNavigationSyncMode(): Promise<NavigationSyncMode> {
  const localMode = readNavigationSyncMode();
  if (!isNativeApp()) {
    return localMode;
  }
  try {
    const { value } = await Preferences.get({ key: NAVIGATION_SYNC_MODE_KEY });
    return value ? parseNavigationSyncMode(value) : localMode;
  } catch {
    return localMode;
  }
}

function persistNavigationSyncMode(mode: NavigationSyncMode) {
  writeNavigationSyncMode(mode);
  if (isNativeApp()) {
    void Preferences.set({ key: NAVIGATION_SYNC_MODE_KEY, value: mode }).catch(() => {
      // Browser storage above remains a best-effort backup.
    });
  }
}

function parseDisplayPrefsValue(
  parsed: Partial<DisplayPrefs> & { mobileTouchSelection?: unknown },
  fallback: DisplayPrefs,
): DisplayPrefs {
  const sidebarWidth =
    typeof parsed.sidebarWidth === "number"
      ? clampSidebarWidth(parsed.sidebarWidth)
      : fallback.sidebarWidth;
  const sidebarOpen =
    typeof parsed.sidebarOpen === "boolean" ? parsed.sidebarOpen : fallback.sidebarOpen;
  const notesPanelWidth =
    typeof parsed.notesPanelWidth === "number"
      ? clampNotesPanelWidth(parsed.notesPanelWidth, sidebarWidth, sidebarOpen)
      : fallback.notesPanelWidth;
  return {
    hostScope:
      parsed.hostScope === "selected" || parsed.hostScope === "all"
        ? parsed.hostScope
        : fallback.hostScope,
    scope: parsed.scope === "all" || parsed.scope === "space" ? parsed.scope : fallback.scope,
    sidebarView:
      parsed.sidebarView === "agents" ||
      parsed.sidebarView === "tabs" ||
      parsed.sidebarView === "notes"
        ? parsed.sidebarView
        : fallback.sidebarView,
    agentSort:
      parsed.agentSort === "attention" ||
      parsed.agentSort === "status" ||
      parsed.agentSort === "workspace" ||
      parsed.agentSort === "lastStatusChange"
        ? parsed.agentSort
        : fallback.agentSort,
    agentGroup:
      parsed.agentGroup === "none" ||
      parsed.agentGroup === "host" ||
      parsed.agentGroup === "workspace" ||
      parsed.agentGroup === "hostWorkspace"
        ? parsed.agentGroup
        : fallback.agentGroup,
    combineMatchingWorkspaceNames: parseCombineMatchingWorkspaceNames(
      parsed.combineMatchingWorkspaceNames,
      fallback.combineMatchingWorkspaceNames,
    ),
    collapsedSidebarGroups: parseCollapsedSidebarGroups(
      parsed.collapsedSidebarGroups,
      fallback.collapsedSidebarGroups,
    ),
    spaceGroup:
      parsed.spaceGroup === "none" || parsed.spaceGroup === "host"
        ? parsed.spaceGroup
        : fallback.spaceGroup,
    agentPinnedOnly:
      typeof parsed.agentPinnedOnly === "boolean"
        ? parsed.agentPinnedOnly
        : fallback.agentPinnedOnly,
    agentActiveOnly:
      typeof parsed.agentActiveOnly === "boolean"
        ? parsed.agentActiveOnly
        : fallback.agentActiveOnly,
    agentFeaturesInTabs: parseAgentFeaturesInTabs(
      parsed.agentFeaturesInTabs,
      fallback.agentFeaturesInTabs,
    ),
    multiHostSpaceSelection: parseMultiHostSpaceSelection(
      parsed.multiHostSpaceSelection,
      fallback.multiHostSpaceSelection,
    ),
    sidebarWidth,
    notesPanelWidth,
    notesListPaneWidth:
      typeof parsed.notesListPaneWidth === "number"
        ? clampNotesListPaneWidth(parsed.notesListPaneWidth, notesPanelWidth)
        : fallback.notesListPaneWidth,
    notesListPaneCollapsed:
      typeof parsed.notesListPaneCollapsed === "boolean"
        ? parsed.notesListPaneCollapsed
        : fallback.notesListPaneCollapsed,
    notesEnabled:
      typeof parsed.notesEnabled === "boolean" ? parsed.notesEnabled : fallback.notesEnabled,
    notesPanelOpen:
      typeof parsed.notesPanelOpen === "boolean" ? parsed.notesPanelOpen : fallback.notesPanelOpen,
    sidebarOpen,
    terminalFontSizePx: parseTerminalFontSizePx(parsed.terminalFontSizePx),
    terminalScreenReaderText: parseTerminalScreenReaderText(
      parsed.terminalScreenReaderText,
      fallback.terminalScreenReaderText,
    ),
    terminalInputTransport: parseTerminalInputTransport(parsed.terminalInputTransport),
    terminalInputBatchDelayMs: parseTerminalInputBatchDelayMs(parsed.terminalInputBatchDelayMs),
    terminalOutputCoalesceMs: parseTerminalOutputCoalesceMs(
      parsed.terminalOutputCoalesceMs,
    ),
    contentInsetTopPx: parseContentInsetTopPx(parsed.contentInsetTopPx),
    contentInsetBottomPx: parseContentInsetBottomPx(parsed.contentInsetBottomPx),
    mobileControlsScalePercent: parseMobileControlsScalePercent(
      parsed.mobileControlsScalePercent,
    ),
    mobileTerminalTapTarget: parseMobileTerminalTapTarget(parsed.mobileTerminalTapTarget),
    mobileLongPressBehavior: parseStoredMobileLongPressBehavior(parsed),
    mobileTouchSelectionEndpointTimeoutMs: parseMobileTouchSelectionEndpointTimeoutMs(
      parsed.mobileTouchSelectionEndpointTimeoutMs,
    ),
    mobileKeyboardHideRefit: parseMobileKeyboardHideRefit(parsed.mobileKeyboardHideRefit),
    mobileCommandExpandingInput: parseMobileCommandExpandingInput(
      parsed.mobileCommandExpandingInput,
    ),
    mobileCommandEnterNewline: parseMobileCommandEnterNewline(
      parsed.mobileCommandEnterNewline,
    ),
    mobileCompactControls: parseMobileCompactControls(parsed.mobileCompactControls),
    theme: parseTheme(parsed.theme),
  };
}

function readLegacyDisplaySelectionPrefs(): LegacyDisplaySelectionPrefs {
  try {
    const raw = window.localStorage.getItem(LEGACY_DISPLAY_PREFS_KEY);
    if (!raw) {
      return { activeSpaceId: null, selectedPaneId: null };
    }
    const parsed = JSON.parse(raw) as { activeSpaceId?: unknown; selectedPaneId?: unknown };
    return {
      activeSpaceId: typeof parsed.activeSpaceId === "string" ? parsed.activeSpaceId : null,
      selectedPaneId: typeof parsed.selectedPaneId === "string" ? parsed.selectedPaneId : null,
    };
  } catch {
    return { activeSpaceId: null, selectedPaneId: null };
  }
}

function readLegacyDisplayPrefs(fallback: DisplayPrefs): DisplayPrefs {
  try {
    const raw = window.localStorage.getItem(LEGACY_DISPLAY_PREFS_KEY);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw) as {
      activeSpaceId?: unknown;
      selectedPaneId?: unknown;
      mobileTouchSelection?: unknown;
    } & Partial<DisplayPrefs>;
    return parseDisplayPrefsValue(parsed, fallback);
  } catch {
    return fallback;
  }
}

function parseScopedPaneRef(value: unknown): ScopedPaneRef | null {
  if (!isRecord(value) || typeof value.bridgeId !== "string" || typeof value.paneId !== "string") {
    return null;
  }
  return { bridgeId: value.bridgeId, paneId: value.paneId };
}

function parseScopedWorkspaceRef(value: unknown): ScopedWorkspaceRef | null {
  if (
    !isRecord(value) ||
    typeof value.bridgeId !== "string" ||
    typeof value.workspaceId !== "string"
  ) {
    return null;
  }
  return { bridgeId: value.bridgeId, workspaceId: value.workspaceId };
}

function parseStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return Object.fromEntries(entries);
}

function clampSidebarWidth(width: number) {
  const viewportMax =
    typeof window === "undefined"
      ? MAX_SIDEBAR_WIDTH
      : Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, window.innerWidth - 360));
  return Math.round(Math.min(Math.max(width, MIN_SIDEBAR_WIDTH), viewportMax));
}

function clampNotesPanelWidth(
  width: number,
  sidebarWidth = DEFAULT_SIDEBAR_WIDTH,
  sidebarOpen = true,
) {
  const reservedWidth = sidebarOpen ? sidebarWidth : 0;
  const viewportMax =
    typeof window === "undefined"
      ? MAX_NOTES_PANEL_WIDTH
      : Math.max(
          MIN_NOTES_PANEL_WIDTH,
          Math.min(MAX_NOTES_PANEL_WIDTH, window.innerWidth - reservedWidth - 320),
        );
  return Math.round(Math.min(Math.max(width, MIN_NOTES_PANEL_WIDTH), viewportMax));
}

function clampNotesListPaneWidth(width: number, notesPanelWidth = DEFAULT_NOTES_PANEL_WIDTH) {
  const maxWidth = Math.max(
    MIN_NOTES_LIST_PANE_WIDTH,
    Math.min(MAX_NOTES_LIST_PANE_WIDTH, notesPanelWidth - 260),
  );
  return Math.round(Math.min(Math.max(width, MIN_NOTES_LIST_PANE_WIDTH), maxWidth));
}

async function writeDisplayPrefs(prefs: DisplayPrefs) {
  const value = JSON.stringify(prefs);
  if (isNativeApp()) {
    try {
      await Preferences.set({ key: DISPLAY_PREFS_KEY, value });
    } catch {
      // Browser storage below remains a best-effort backup.
    }
  }
  try {
    window.localStorage.setItem(DISPLAY_PREFS_KEY, value);
    window.localStorage.removeItem(LEGACY_DISPLAY_PREFS_KEY);
  } catch {
    // Storage can be unavailable in private or locked-down browser contexts.
  }
}

async function writeSharedNavigationPrefs(prefs: SharedNavigationPrefs) {
  const value = JSON.stringify(prefs);
  if (isNativeApp()) {
    try {
      await Preferences.set({ key: SHARED_NAVIGATION_PREFS_KEY, value });
    } catch {
      // Browser storage below remains a best-effort backup.
    }
  }
  try {
    window.localStorage.setItem(SHARED_NAVIGATION_PREFS_KEY, value);
  } catch {
    // Storage can be unavailable in private or locked-down browser contexts.
  }
}

function isNativeApp() {
  return Capacitor.isNativePlatform();
}

function parseStoredMobileLongPressBehavior(
  parsed: Partial<DisplayPrefs> & { mobileTouchSelection?: unknown },
): MobileLongPressBehavior {
  if (parsed.mobileLongPressBehavior !== undefined) {
    return parseMobileLongPressBehavior(parsed.mobileLongPressBehavior);
  }
  if (parsed.mobileTouchSelection === true) {
    return "copy";
  }
  if (parsed.mobileTouchSelection === false) {
    return "off";
  }
  return DEFAULT_MOBILE_LONG_PRESS_BEHAVIOR;
}

export function parseCombineMatchingWorkspaceNames(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

const MAX_COLLAPSED_SIDEBAR_GROUPS = 4096;

export function parseCollapsedSidebarGroups(value: unknown, fallback: string[] = []) {
  if (!Array.isArray(value)) {
    return fallback;
  }
  return [
    ...new Set(
      value.filter((item): item is string => typeof item === "string" && item.length > 0),
    ),
  ].slice(-MAX_COLLAPSED_SIDEBAR_GROUPS);
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

function usePointerDragResize(
  active: boolean,
  onMove: (event: PointerEvent) => void,
  onEnd: () => void,
) {
  useEffect(() => {
    if (!active) {
      return;
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd, { once: true });
    window.addEventListener("pointercancel", onEnd, { once: true });
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [active, onMove, onEnd]);
}

export function App() {
  const bridge = useBridge();
  const initialPrefs = useMemo(readDisplayPrefs, []);
  const initialSharedNavigationPrefs = useMemo(readSharedNavigationPrefs, []);
  const initialNavigationSyncMode = useMemo(readNavigationSyncMode, []);
  const legacySelectionPrefs = useMemo(readLegacyDisplaySelectionPrefs, []);
  const [displayPrefsLoaded, setDisplayPrefsLoaded] = useState(() => !isNativeApp());
  const [connectionStates, setConnectionStates] = useState<Record<string, BridgeConnectionState>>({});
  const [agentActivityStates, setAgentActivityStates] =
    useState<Record<string, BridgeAgentActivityState>>({});
  const [agentPinsStates, setAgentPinsStates] = useState<Record<string, BridgeAgentPinsState>>({});
  const [notesStates, setNotesStates] = useState<Record<string, BridgeNotesState>>({});
  const [launcherPresetStates, setLauncherPresetStates] = useState<
    Record<string, BridgeLauncherPresetsState>
  >({});
  const launcherPresetStatesRef = useRef(launcherPresetStates);
  const [selectedBridgeId, setSelectedBridgeId] = useState<BridgeId | null>(
    initialSharedNavigationPrefs.selectedBridgeId,
  );
  const [navigationSyncMode, setNavigationSyncMode] = useState<NavigationSyncMode>(
    initialNavigationSyncMode,
  );
  const navigationIsShared = sharesNavigation(navigationSyncMode);
  const [selectedNoteRef, setSelectedNoteRef] = useState<ScopedNoteRef | null>(null);
  const [noteTitleFocusRequest, setNoteTitleFocusRequest] =
    useState<ScopedNoteTitleFocusRequest | null>(null);
  const [notesPanelOpen, setNotesPanelOpen] = useState(
    initialPrefs.notesEnabled && initialPrefs.notesPanelOpen,
  );
  const [mobileNotesScreen, setMobileNotesScreen] = useState<MobileNotesScreen>("list");
  const [notesIncludeArchived, setNotesIncludeArchived] = useState(false);
  const [notesIncludeDeleted, setNotesIncludeDeleted] = useState(false);
  const [quickPaneNoteTarget, setQuickPaneNoteTarget] = useState<QuickPaneNoteTarget | null>(null);
  const [quickPaneNoteCreating, setQuickPaneNoteCreating] = useState(false);
  const [selectedPaneRefState, setSelectedPaneRefState] = useState<ScopedPaneRef | null>(
    initialSharedNavigationPrefs.selectedPane,
  );
  const [activeWorkspaceRefState, setActiveWorkspaceRefState] = useState<ScopedWorkspaceRef | null>(
    initialSharedNavigationPrefs.activeWorkspace,
  );
  const [selectedPanesByBridgeId, setSelectedPanesByBridgeId] = useState<Record<string, string>>(
    initialSharedNavigationPrefs.selectedPanesByBridgeId,
  );
  const [activeWorkspacesByBridgeId, setActiveWorkspacesByBridgeId] = useState<Record<string, string>>(
    initialSharedNavigationPrefs.activeWorkspacesByBridgeId,
  );
  const [hostScope, setHostScope] = useState<HostScope>(initialPrefs.hostScope);
  const [scope, setScope] = useState<Scope>(initialPrefs.scope);
  const [sidebarView, setSidebarView] = useState<SidebarView>(initialPrefs.sidebarView);
  const [agentSort, setAgentSort] = useState<AgentSort>(initialPrefs.agentSort);
  const [agentGroup, setAgentGroup] = useState<AgentGroup>(initialPrefs.agentGroup);
  const [combineMatchingWorkspaceNames, setCombineMatchingWorkspaceNames] = useState(
    initialPrefs.combineMatchingWorkspaceNames,
  );
  const [collapsedSidebarGroups, setCollapsedSidebarGroups] = useState(
    initialPrefs.collapsedSidebarGroups,
  );
  const collapsedSidebarGroupKeys = useMemo(
    () => new Set(collapsedSidebarGroups),
    [collapsedSidebarGroups],
  );
  const toggleCollapsedSidebarGroup = useCallback((key: string) => {
    setCollapsedSidebarGroups((current) =>
      updateCollapsedSidebarGroups(current, [key], !current.includes(key)),
    );
  }, []);
  const setVisibleSidebarGroupsCollapsed = useCallback(
    (keys: readonly string[], collapsed: boolean) => {
      setCollapsedSidebarGroups((current) =>
        updateCollapsedSidebarGroups(current, keys, collapsed),
      );
    },
    [],
  );
  const [spaceGroup, setSpaceGroup] = useState<SpaceGroup>(initialPrefs.spaceGroup);
  const [agentPinnedOnly, setAgentPinnedOnly] = useState(initialPrefs.agentPinnedOnly);
  const [agentActiveOnly, setAgentActiveOnly] = useState(initialPrefs.agentActiveOnly);
  const [agentFeaturesInTabs, setAgentFeaturesInTabs] = useState(initialPrefs.agentFeaturesInTabs);
  const [multiHostSpaceSelection, setMultiHostSpaceSelection] = useState(
    initialPrefs.multiHostSpaceSelection,
  );
  const [sidebarWidth, setSidebarWidth] = useState(initialPrefs.sidebarWidth);
  const [notesPanelWidth, setNotesPanelWidth] = useState(initialPrefs.notesPanelWidth);
  const [notesListPaneWidth, setNotesListPaneWidth] = useState(initialPrefs.notesListPaneWidth);
  const [notesListPaneCollapsed, setNotesListPaneCollapsed] = useState(
    initialPrefs.notesListPaneCollapsed,
  );
  const notesEnabledRef = useRef(initialPrefs.notesEnabled);
  const pendingCreatedPaneNotesRef = useRef<Record<string, PendingCreatedPaneNote[]>>({});
  const [notesEnabled, setNotesEnabledState] = useState(initialPrefs.notesEnabled);
  const setNotesEnabled = useCallback((enabled: boolean) => {
    notesEnabledRef.current = enabled;
    setNotesEnabledState(enabled);
  }, []);
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const [resizingNotesPanel, setResizingNotesPanel] = useState(false);
  const [resizingNotesListPane, setResizingNotesListPane] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(initialPrefs.sidebarOpen);
  const [showDetail, setShowDetail] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [spaceReorderMode, setSpaceReorderMode] = useState<SpaceReorderMode | null>(null);
  const [spaceReorderAnnouncement, setSpaceReorderAnnouncement] = useState("");
  const spaceReorderAnnouncementFrameRef = useRef<number | null>(null);
  const announceSpaceReorder = useCallback((message: string) => {
    if (spaceReorderAnnouncementFrameRef.current !== null) {
      window.cancelAnimationFrame(spaceReorderAnnouncementFrameRef.current);
    }
    setSpaceReorderAnnouncement("");
    spaceReorderAnnouncementFrameRef.current = window.requestAnimationFrame(() => {
      setSpaceReorderAnnouncement(message);
      spaceReorderAnnouncementFrameRef.current = null;
    });
  }, []);
  const closeSpaceReorder = useCallback(() => setSpaceReorderMode(null), []);
  const cancelSpaceReorder = useCallback(() => {
    announceSpaceReorder("Canceled moving space.");
    closeSpaceReorder();
  }, [announceSpaceReorder, closeSpaceReorder]);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [showPaneSearch, setShowPaneSearch] = useState(false);
  const [noteDeleteTarget, setNoteDeleteTarget] = useState<ScopedNoteEntry | null>(null);
  const [deletingNote, setDeletingNote] = useState(false);
  const [backendSettingsOpen, setBackendSettingsOpen] = useState(false);
  const [terminalFontSizePx, setTerminalFontSizePx] = useState(
    initialPrefs.terminalFontSizePx,
  );
  const [terminalScreenReaderText, setTerminalScreenReaderText] = useState(
    initialPrefs.terminalScreenReaderText,
  );
  const [terminalInputTransport, setTerminalInputTransport] = useState(
    initialPrefs.terminalInputTransport,
  );
  const [terminalInputBatchDelayMs, setTerminalInputBatchDelayMs] = useState(
    initialPrefs.terminalInputBatchDelayMs,
  );
  const [terminalOutputCoalesceMs, setTerminalOutputCoalesceMs] = useState(
    initialPrefs.terminalOutputCoalesceMs,
  );
  const [contentInsetTopPx, setContentInsetTopPx] = useState(initialPrefs.contentInsetTopPx);
  const [contentInsetBottomPx, setContentInsetBottomPx] = useState(
    initialPrefs.contentInsetBottomPx,
  );
  const [mobileControlsScalePercent, setMobileControlsScalePercent] = useState(
    initialPrefs.mobileControlsScalePercent,
  );
  const [mobileTerminalTapTarget, setMobileTerminalTapTarget] = useState(
    initialPrefs.mobileTerminalTapTarget,
  );
  const [mobileLongPressBehavior, setMobileLongPressBehavior] = useState(
    initialPrefs.mobileLongPressBehavior,
  );
  const [
    mobileTouchSelectionEndpointTimeoutMs,
    setMobileTouchSelectionEndpointTimeoutMs,
  ] = useState(initialPrefs.mobileTouchSelectionEndpointTimeoutMs);
  const [mobileKeyboardHideRefit, setMobileKeyboardHideRefit] = useState(
    initialPrefs.mobileKeyboardHideRefit,
  );
  const [mobileCommandExpandingInput, setMobileCommandExpandingInput] = useState(
    initialPrefs.mobileCommandExpandingInput,
  );
  const [mobileCommandEnterNewline, setMobileCommandEnterNewline] = useState(
    initialPrefs.mobileCommandEnterNewline,
  );
  const [mobileCompactControls, setMobileCompactControls] = useState(
    initialPrefs.mobileCompactControls,
  );
  const [theme, setTheme] = useState(initialPrefs.theme);
  const [launchTarget, setLaunchTarget] = useState<ScopedLaunchTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refitToken, setRefitToken] = useState(0);
  const [terminalFocusToken, setTerminalFocusToken] = useState(0);
  const isCompactLayout = useIsCompactLayout();
  const isTouchInput = useIsTouchInput();
  const showMobileKeyboardHideRefit = isNativeAndroid();
  const connectionRefs = useRef<Record<string, BridgeConnectionRef>>({});
  const isCompactLayoutRef = useRef(isCompactLayout);
  const showDetailRef = useRef(showDetail);
  const selectedBridgeIdRef = useRef(selectedBridgeId);
  const pendingSharedPaneSelectionsRef = useRef<Record<string, PendingSharedPaneSelection>>({});
  const mobileSidebarHistoryRef = useRef(false);
  const mobileDetailHistoryRef = useRef(false);
  const legacySelectionAppliedRef = useRef(false);
  const selectedNotePaneKeyRef = useRef("");
  const notesListResizeLeftRef = useRef(0);
  const sidebarResizePressRef = useRef<{
    timer: number;
    pointerId: number;
    x: number;
    y: number;
    target: HTMLDivElement;
  } | null>(null);
  const clearPendingSharedPaneSelection = useCallback((
    bridgeId: BridgeId,
    paneId?: string,
    connectionKey?: string,
  ) => {
    const pending = pendingSharedPaneSelectionsRef.current[bridgeId];
    if (
      !pending ||
      (paneId && pending.paneId !== paneId) ||
      (connectionKey && pending.connectionKey !== connectionKey)
    ) {
      return false;
    }
    window.clearTimeout(pending.timeoutId);
    delete pendingSharedPaneSelectionsRef.current[bridgeId];
    return true;
  }, []);

  useEffect(
    () => () => {
      for (const bridgeId of Object.keys(pendingSharedPaneSelectionsRef.current)) {
        clearPendingSharedPaneSelection(bridgeId);
      }
    },
    [clearPendingSharedPaneSelection],
  );

  useEffect(() => {
    if (displayPrefsLoaded) {
      return;
    }
    let cancelled = false;
    void Promise.all([
      loadDisplayPrefs(),
      loadSharedNavigationPrefs(),
      loadNavigationSyncMode(),
    ]).then(
      ([prefs, sharedNavigationPrefs, loadedNavigationSyncMode]) => {
      if (cancelled) {
        return;
      }
      setHostScope(prefs.hostScope);
      setScope(prefs.scope);
      setSidebarView(prefs.sidebarView);
      setAgentSort(prefs.agentSort);
      setAgentGroup(prefs.agentGroup);
      setCombineMatchingWorkspaceNames(prefs.combineMatchingWorkspaceNames);
      setCollapsedSidebarGroups(prefs.collapsedSidebarGroups);
      setSpaceGroup(prefs.spaceGroup);
      setAgentPinnedOnly(prefs.agentPinnedOnly);
      setAgentActiveOnly(prefs.agentActiveOnly);
      setAgentFeaturesInTabs(prefs.agentFeaturesInTabs);
      setMultiHostSpaceSelection(prefs.multiHostSpaceSelection);
      setSidebarWidth(prefs.sidebarWidth);
      setNotesPanelWidth(prefs.notesPanelWidth);
      setNotesListPaneWidth(prefs.notesListPaneWidth);
      setNotesListPaneCollapsed(prefs.notesListPaneCollapsed);
      setNotesEnabled(prefs.notesEnabled);
      setNotesPanelOpen(prefs.notesEnabled && prefs.notesPanelOpen);
      setSidebarOpen(prefs.sidebarOpen);
      setNavigationSyncMode(loadedNavigationSyncMode);
      setSelectedBridgeId(sharedNavigationPrefs.selectedBridgeId);
      setSelectedPaneRefState(sharedNavigationPrefs.selectedPane);
      setActiveWorkspaceRefState(sharedNavigationPrefs.activeWorkspace);
      setSelectedPanesByBridgeId(sharedNavigationPrefs.selectedPanesByBridgeId);
      setActiveWorkspacesByBridgeId(sharedNavigationPrefs.activeWorkspacesByBridgeId);
      setTerminalFontSizePx(prefs.terminalFontSizePx);
      setTerminalScreenReaderText(prefs.terminalScreenReaderText);
      setTerminalInputTransport(prefs.terminalInputTransport);
      setTerminalInputBatchDelayMs(prefs.terminalInputBatchDelayMs);
      setTerminalOutputCoalesceMs(prefs.terminalOutputCoalesceMs);
      setContentInsetTopPx(prefs.contentInsetTopPx);
      setContentInsetBottomPx(prefs.contentInsetBottomPx);
      setMobileControlsScalePercent(prefs.mobileControlsScalePercent);
      setMobileTerminalTapTarget(prefs.mobileTerminalTapTarget);
      setMobileLongPressBehavior(prefs.mobileLongPressBehavior);
      setMobileTouchSelectionEndpointTimeoutMs(prefs.mobileTouchSelectionEndpointTimeoutMs);
      setMobileKeyboardHideRefit(prefs.mobileKeyboardHideRefit);
      setMobileCommandExpandingInput(prefs.mobileCommandExpandingInput);
      setMobileCommandEnterNewline(prefs.mobileCommandEnterNewline);
      setMobileCompactControls(prefs.mobileCompactControls);
      setTheme(prefs.theme);
      setDisplayPrefsLoaded(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [displayPrefsLoaded]);

  useEffect(() => {
    return addNativeBackHandler(() => {
      if (noteDeleteTarget) {
        if (!deletingNote) {
          setNoteDeleteTarget(null);
        }
        return true;
      }
      if (menu) {
        setMenu(null);
        return true;
      }
      if (dialog) {
        setDialog(null);
        return true;
      }
      if (launchTarget) {
        setLaunchTarget(null);
        return true;
      }
      if (backendSettingsOpen) {
        setBackendSettingsOpen(false);
        return true;
      }
      if (spaceReorderMode) {
        cancelSpaceReorder();
        return true;
      }
      if (notesPanelOpen) {
        setNotesPanelOpen(false);
        return true;
      }
      return false;
    });
  }, [
    backendSettingsOpen,
    cancelSpaceReorder,
    deletingNote,
    dialog,
    launchTarget,
    menu,
    noteDeleteTarget,
    notesPanelOpen,
    spaceReorderMode,
  ]);

  useEffect(() => {
    if (!spaceReorderMode) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelSpaceReorder();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancelSpaceReorder, spaceReorderMode]);

  useEffect(
    () => () => {
      if (spaceReorderAnnouncementFrameRef.current !== null) {
        window.cancelAnimationFrame(spaceReorderAnnouncementFrameRef.current);
      }
    },
    [],
  );

  const bridgeViews = useMemo<BridgeConnectionView[]>(
    () =>
      bridge.enabledRuntimes.map((runtime) => {
        const state = connectionStates[runtime.id];
        const currentState = state?.connectionKey === runtime.connectionKey ? state : null;
        return {
          runtime,
          snapshot: currentState?.snapshot ?? null,
          loadState: currentState?.loadState ?? (runtime.canConnect ? "loading" : "ready"),
        };
      }),
    [bridge.enabledRuntimes, connectionStates],
  );
  const pinnedAgentKeys = useMemo(
    () => buildAgentPinKeySet(bridgeViews, agentPinsStates),
    [agentPinsStates, bridgeViews],
  );
  const agentActivityTransitions = useMemo(
    () => buildAgentActivityTransitionMap(bridgeViews, agentActivityStates),
    [agentActivityStates, bridgeViews],
  );
  const effectiveAgentPinnedOnly =
    visibleHostBridgeViews(bridgeViews, selectedBridgeId, hostScope).some((view) =>
      supportsAgentPins(view.runtime.capabilities),
    ) && agentPinnedOnly;
  const selectedRuntime = useMemo(
    () =>
      selectedBridgeId
        ? (bridge.enabledRuntimes.find((runtime) => runtime.id === selectedBridgeId) ?? null)
        : null,
    [bridge.enabledRuntimes, selectedBridgeId],
  );
  const selectedConnectionState =
    selectedRuntime && connectionStates[selectedRuntime.id]?.connectionKey === selectedRuntime.connectionKey
      ? connectionStates[selectedRuntime.id]
      : null;
  const snapshot = selectedConnectionState?.snapshot ?? null;
  const loadState: LoadState = selectedConnectionState?.loadState ?? (selectedRuntime ? "loading" : "ready");
  const selectedRawPaneId =
    selectedRuntime && selectedPaneRefState?.bridgeId === selectedRuntime.id
      ? selectedPaneRefState.paneId
      : selectedRuntime
        ? (selectedPanesByBridgeId[selectedRuntime.id] ?? null)
        : null;
  const activeWorkspaceId =
    selectedRuntime && activeWorkspaceRefState?.bridgeId === selectedRuntime.id
      ? activeWorkspaceRefState.workspaceId
      : selectedRuntime
        ? (activeWorkspacesByBridgeId[selectedRuntime.id] ?? null)
        : null;
  const preferSharedSnapshotSelection =
    navigationIsShared &&
    Boolean(selectedRuntime) &&
    !pendingSharedPaneSelectionsRef.current[selectedRuntime?.id ?? ""];
  const resolvedPaneId = chooseSelectedPane(
    snapshot,
    selectedRawPaneId,
    navigationIsShared,
    preferSharedSnapshotSelection,
  );
  const supportedCommands =
    selectedRuntime?.capabilityState === "ready" ? (selectedRuntime.capabilities?.commands ?? []) : [];
  const splitSupported = supportedCommands.includes("pane.split");
  const paneFocusSupported = supportedCommands.includes("pane.focus_direction");
  const selectedHttpUrl = useMemo(
    () => selectedRuntime?.httpUrl ?? disconnectedHttpUrl,
    [selectedRuntime?.connectionKey],
  );
  const selectedWsUrl = useMemo(
    () => selectedRuntime?.wsUrl ?? disconnectedWsUrl,
    [selectedRuntime?.connectionKey],
  );
  const selectedCommands = useMemo(
    () => (selectedRuntime ? createCommands(selectedHttpUrl) : null),
    [selectedHttpUrl, selectedRuntime?.id],
  );
  const launchRuntime = launchTarget ? bridge.getRuntime(launchTarget.bridgeId) : null;
  const launchPresetState =
    launchRuntime &&
    launcherPresetStates[launchRuntime.id]?.connectionKey === launchRuntime.connectionKey
      ? launcherPresetStates[launchRuntime.id]
      : null;
  const launcherSupported = supportsLauncherPresets(launchRuntime?.capabilities);
  const launchOptions =
    launcherSupported && launchPresetState?.response ? launchPresetState.response.presets : [];
  const launchEmptyMessage = launcherEmptyMessage(
    Boolean(launchRuntime),
    launcherSupported,
    launchPresetState,
  );

  useEffect(() => {
    launcherPresetStatesRef.current = launcherPresetStates;
  }, [launcherPresetStates]);

  useEffect(() => {
    if (!launchRuntime || !supportsLauncherPresets(launchRuntime.capabilities)) {
      return;
    }
    const current = launcherPresetStatesRef.current[launchRuntime.id];
    if (
      current?.connectionKey === launchRuntime.connectionKey &&
      current.loadState === "loading"
    ) {
      return;
    }
    const runtime = launchRuntime;
    setLauncherPresetStates((states) => ({
      ...states,
      [runtime.id]: {
        connectionKey: runtime.connectionKey,
        response:
          current?.connectionKey === runtime.connectionKey ? current.response : null,
        loadState: "loading",
        error: null,
      },
    }));
    void fetchLauncherPresets(runtime.httpUrl)
      .then((response) => {
        setLauncherPresetStates((states) => {
          const current = states[runtime.id];
          if (current && current.connectionKey !== runtime.connectionKey) {
            return states;
          }
          return {
            ...states,
            [runtime.id]: {
              connectionKey: runtime.connectionKey,
              response,
              loadState: "ready",
              error: null,
            },
          };
        });
      })
      .catch((err: unknown) => {
        setLauncherPresetStates((states) => {
          const current = states[runtime.id];
          if (current && current.connectionKey !== runtime.connectionKey) {
            return states;
          }
          return {
            ...states,
            [runtime.id]: {
              connectionKey: runtime.connectionKey,
              response: null,
              loadState: "error",
              error: err instanceof Error ? err.message : String(err),
            },
          };
        });
      });
  }, [
    launchRuntime?.connectionKey,
    launchRuntime?.id,
    launchRuntime?.capabilities,
  ]);
  const menuRuntime = menu ? bridge.getRuntime(menu.bridgeId) : null;
  const menuConnectionState =
    menuRuntime && connectionStates[menuRuntime.id]?.connectionKey === menuRuntime.connectionKey
      ? connectionStates[menuRuntime.id]
      : null;
  const menuCommandsReady = Boolean(
    menuRuntime?.canConnect &&
      menuRuntime.capabilityState === "ready" &&
      menuConnectionState?.loadState === "ready" &&
      menuConnectionState.snapshot,
  );
  const menuSupportedCommands = menuCommandsReady ? (menuRuntime?.capabilities?.commands ?? []) : [];
  const menuPaneMoveSupported = menuSupportedCommands.includes("pane.move");
  const menuWorkspace =
    menu?.kind === "space"
      ? menuConnectionState?.snapshot?.workspaces.find(
          (workspace) => workspace.workspace_id === menu.id,
        )
      : undefined;
  const menuWorkspaceReorderSupported = Boolean(
    menuWorkspace &&
      !menuWorkspace.worktree?.is_linked_worktree &&
      menuConnectionState?.snapshot &&
      workspaceReorderRoots(menuConnectionState.snapshot.workspaces).length > 1 &&
      menuSupportedCommands.includes("workspace.move_block"),
  );
  const menuAgentPinsSupported = Boolean(
    menu &&
      menu.kind === "pane" &&
      menu.pinLabel &&
      menuRuntime?.canConnect &&
      menuRuntime.capabilityState === "ready" &&
      supportsAgentPins(menuRuntime.capabilities),
  );
  const menuNotesSupported = canAddNoteFromPaneMenu({
    kind: menu?.kind ?? "space",
    notesEnabled,
    runtimeCanConnect: menuRuntime?.canConnect === true,
    capabilityState: menuRuntime?.capabilityState ?? "idle",
    notesSupported: supportsNotes(menuRuntime?.capabilities),
    runtimeConnectionKey: menuRuntime?.connectionKey ?? "",
    stateConnectionKey: menuConnectionState?.connectionKey ?? null,
    paneExists: Boolean(
      menu &&
        menu.kind === "pane" &&
        menuConnectionState?.snapshot?.panes.some((pane) => pane.pane_id === menu.id),
    ),
  });
  const menuPinLabel = menu?.pinLabel ?? "pane";
  const menuPanePinned = menu
    ? isAgentPinned(pinnedAgentKeys, menu.bridgeId, menu.id)
    : false;
  const activeMenuItems = menu
    ? menuItems(
        menu.kind,
        menuPaneMoveSupported,
        menuCommandsReady,
        menuAgentPinsSupported,
        menuPanePinned,
        menuPinLabel,
        menuNotesSupported,
        menuWorkspaceReorderSupported,
      )
    : [];

  useEffect(() => {
    if (menu && activeMenuItems.length === 0) {
      setMenu(null);
    }
  }, [activeMenuItems.length, menu]);

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
    selectedBridgeIdRef.current = selectedBridgeId;
  }, [selectedBridgeId]);

  useEffect(() => {
    if (!bridge.storeLoaded) {
      return;
    }
    const enabledIds = bridge.enabledBridgeIds;
    setSelectedBridgeId((current) => {
      return resolveInitialSelectedBridgeId(current, enabledIds, bridge.lastSelectedBridgeId);
    });
  }, [bridge.enabledBridgeIds, bridge.lastSelectedBridgeId, bridge.storeLoaded]);

  useEffect(() => {
    if (shouldCollapseHostScope(hostScope, bridge.enabledBridgeIds.length, bridge.storeLoaded)) {
      setHostScope("selected");
    }
  }, [bridge.enabledBridgeIds.length, bridge.storeLoaded, hostScope]);

  useEffect(() => {
    if (!bridge.storeLoaded) {
      return;
    }
    bridge.setLastSelectedBridgeId(selectedRuntime?.id ?? null);
  }, [bridge.setLastSelectedBridgeId, bridge.storeLoaded, selectedRuntime?.id]);

  useEffect(() => {
    if (
      legacySelectionAppliedRef.current ||
      !bridge.storeLoaded ||
      !selectedRuntime ||
      (!legacySelectionPrefs.selectedPaneId && !legacySelectionPrefs.activeSpaceId)
    ) {
      return;
    }
    legacySelectionAppliedRef.current = true;
    if (selectedPaneRefState || activeWorkspaceRefState) {
      return;
    }
    if (legacySelectionPrefs.selectedPaneId) {
      const paneId = legacySelectionPrefs.selectedPaneId;
      setSelectedPaneRefState({
        bridgeId: selectedRuntime.id,
        paneId,
      });
      setSelectedPanesByBridgeId((current) =>
        current[selectedRuntime.id]
          ? current
          : { ...current, [selectedRuntime.id]: paneId },
      );
    }
    if (legacySelectionPrefs.activeSpaceId) {
      const workspaceId = legacySelectionPrefs.activeSpaceId;
      setActiveWorkspaceRefState({
        bridgeId: selectedRuntime.id,
        workspaceId,
      });
      setActiveWorkspacesByBridgeId((current) =>
        current[selectedRuntime.id]
          ? current
          : { ...current, [selectedRuntime.id]: workspaceId },
      );
    }
  }, [
    activeWorkspaceRefState,
    bridge.storeLoaded,
    legacySelectionPrefs.activeSpaceId,
    legacySelectionPrefs.selectedPaneId,
    selectedPaneRefState,
    selectedRuntime,
  ]);

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

  // Sync current bridge/pane/workspace selection to URL for persistence
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hasUrlSelection =
      params.has("bridge") || params.has("pane") || params.has("workspace");
    if (hasUrlSelection) {
      return; // Don't overwrite URL-seeded selection
    }
    if (selectedRuntime && selectedPaneRefState) {
      const urlParams = new URLSearchParams(window.location.search);
      urlParams.set("bridge", selectedRuntime.id);
      urlParams.set("pane", selectedPaneRefState.paneId);
      if (activeWorkspaceRefState?.workspaceId) {
        urlParams.set("workspace", activeWorkspaceRefState.workspaceId);
      } else {
        urlParams.delete("workspace");
      }
      const newUrl = `${window.location.pathname}?${urlParams.toString()}${window.location.hash}`;
      window.history.replaceState(null, "", newUrl);
    }
  }, [selectedRuntime?.id, selectedPaneRefState, activeWorkspaceRefState?.workspaceId]);

  // Seed selection from URL params on initial load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlBridgeId = params.get("bridge");
    const urlPaneId = params.get("pane");
    const urlWorkspaceId = params.get("workspace");
    if (urlBridgeId && urlPaneId) {
      setSelectedBridgeId(urlBridgeId);
      setSelectedPaneRefState({ bridgeId: urlBridgeId, paneId: urlPaneId });
      if (urlWorkspaceId) {
        setActiveWorkspaceRefState({ bridgeId: urlBridgeId, workspaceId: urlWorkspaceId });
      }
    }
  }, []); // Only run on mount

  useEffect(() => {
    if (!selectedRuntime) {
      setSelectedPaneRefState(null);
      setActiveWorkspaceRefState(null);
      return;
    }
    const restoredPaneId = selectedPanesByBridgeId[selectedRuntime.id] ?? null;
    const restoredWorkspaceId = activeWorkspacesByBridgeId[selectedRuntime.id] ?? null;
    if (
      navigationIsShared &&
      snapshot?.selected_pane_id &&
      pendingSharedPaneSelectionsRef.current[selectedRuntime.id]?.paneId ===
        snapshot.selected_pane_id
    ) {
      clearPendingSharedPaneSelection(selectedRuntime.id, snapshot.selected_pane_id);
    }
    const nextPaneId = chooseSelectedPaneForActiveWorkspace(
      snapshot,
      restoredPaneId,
      restoredWorkspaceId,
      navigationIsShared,
      navigationIsShared &&
        !pendingSharedPaneSelectionsRef.current[selectedRuntime.id],
    );
    setSelectedPaneRefState((current) => {
      if (!nextPaneId) {
        return current === null ? current : null;
      }
      return current?.bridgeId === selectedRuntime.id && current.paneId === nextPaneId
        ? current
        : { bridgeId: selectedRuntime.id, paneId: nextPaneId };
    });
    if (nextPaneId) {
      setSelectedPanesByBridgeId((current) =>
        current[selectedRuntime.id] === nextPaneId
          ? current
          : { ...current, [selectedRuntime.id]: nextPaneId },
      );
      const pane = snapshot?.panes.find((item) => item.pane_id === nextPaneId);
      if (pane) {
        setActiveWorkspaceRefState((current) =>
          current?.bridgeId === selectedRuntime.id && current.workspaceId === pane.workspace_id
            ? current
            : { bridgeId: selectedRuntime.id, workspaceId: pane.workspace_id },
        );
        setActiveWorkspacesByBridgeId((current) =>
          current[selectedRuntime.id] === pane.workspace_id
            ? current
            : { ...current, [selectedRuntime.id]: pane.workspace_id },
        );
      }
      return;
    }
    setActiveWorkspaceRefState((current) => {
      if (!restoredWorkspaceId) {
        return current === null ? current : null;
      }
      return current?.bridgeId === selectedRuntime.id && current.workspaceId === restoredWorkspaceId
        ? current
        : { bridgeId: selectedRuntime.id, workspaceId: restoredWorkspaceId };
    });
  }, [
    activeWorkspacesByBridgeId,
    clearPendingSharedPaneSelection,
    navigationIsShared,
    selectedPanesByBridgeId,
    selectedRuntime?.id,
    snapshot,
  ]);

  useEffect(() => {
    if (!displayPrefsLoaded || !navigationIsShared) {
      return;
    }
    void writeSharedNavigationPrefs({
      selectedBridgeId,
      selectedPane: selectedPaneRefState,
      activeWorkspace: activeWorkspaceRefState,
      selectedPanesByBridgeId,
      activeWorkspacesByBridgeId,
    });
  }, [
    activeWorkspaceRefState,
    activeWorkspacesByBridgeId,
    displayPrefsLoaded,
    navigationIsShared,
    selectedBridgeId,
    selectedPaneRefState,
    selectedPanesByBridgeId,
  ]);

  useEffect(() => {
    if (!displayPrefsLoaded) {
      return;
    }
    void writeDisplayPrefs({
      hostScope,
      scope,
      sidebarView,
      agentSort,
      agentGroup,
      combineMatchingWorkspaceNames,
      collapsedSidebarGroups,
      spaceGroup,
      agentPinnedOnly,
      agentActiveOnly,
      agentFeaturesInTabs,
      multiHostSpaceSelection,
      sidebarWidth,
      notesPanelWidth,
      notesListPaneWidth,
      notesListPaneCollapsed,
      notesEnabled,
      notesPanelOpen,
      sidebarOpen,
      terminalFontSizePx,
      terminalScreenReaderText,
      terminalInputTransport,
      terminalInputBatchDelayMs,
      terminalOutputCoalesceMs,
      contentInsetTopPx,
      contentInsetBottomPx,
      mobileControlsScalePercent,
      mobileTerminalTapTarget,
      mobileLongPressBehavior,
      mobileTouchSelectionEndpointTimeoutMs,
      mobileKeyboardHideRefit,
      mobileCommandExpandingInput,
      mobileCommandEnterNewline,
      mobileCompactControls,
      theme,
    });
  }, [
    displayPrefsLoaded,
    hostScope,
    scope,
    sidebarView,
    agentSort,
    agentGroup,
    combineMatchingWorkspaceNames,
    collapsedSidebarGroups,
    spaceGroup,
    agentPinnedOnly,
    agentActiveOnly,
    agentFeaturesInTabs,
    multiHostSpaceSelection,
    sidebarWidth,
    notesPanelWidth,
    notesListPaneWidth,
    notesListPaneCollapsed,
    notesEnabled,
    notesPanelOpen,
    sidebarOpen,
    terminalFontSizePx,
    terminalScreenReaderText,
    terminalInputTransport,
    terminalInputBatchDelayMs,
    terminalOutputCoalesceMs,
    contentInsetTopPx,
    contentInsetBottomPx,
    mobileControlsScalePercent,
    mobileTerminalTapTarget,
    mobileLongPressBehavior,
    mobileTouchSelectionEndpointTimeoutMs,
    mobileKeyboardHideRefit,
    mobileCommandExpandingInput,
    mobileCommandEnterNewline,
    mobileCompactControls,
    theme,
  ]);

  useEffect(() => {
    applyTheme(document, theme);
  }, [theme]);

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
    setNotesPanelWidth((width) => clampNotesPanelWidth(width, sidebarWidth, sidebarOpen));
    setNotesListPaneWidth((width) => clampNotesListPaneWidth(width, notesPanelWidth));
  }, [isCompactLayout, notesPanelWidth, sidebarOpen, sidebarWidth]);

  useEffect(() => {
    if (notesEnabled) {
      return;
    }
    setNotesPanelOpen(false);
    setSelectedNoteRef(null);
    setNotesStates({});
    pendingCreatedPaneNotesRef.current = {};
    if (sidebarView === "notes") {
      setSidebarView("agents");
    }
  }, [notesEnabled, sidebarView]);

  const clearSidebarResizePress = useCallback(() => {
    const pending = sidebarResizePressRef.current;
    if (!pending) {
      return;
    }
    window.clearTimeout(pending.timer);
    if (pending.target.hasPointerCapture(pending.pointerId)) {
      pending.target.releasePointerCapture(pending.pointerId);
    }
    sidebarResizePressRef.current = null;
  }, []);

  usePointerDragResize(
    resizingSidebar,
    useCallback((event: PointerEvent) => {
      setSidebarWidth(clampSidebarWidth(event.clientX));
    }, []),
    useCallback(() => setResizingSidebar(false), []),
  );

  usePointerDragResize(
    resizingNotesPanel,
    useCallback(
      (event: PointerEvent) => {
        setNotesPanelWidth(
          clampNotesPanelWidth(window.innerWidth - event.clientX, sidebarWidth, sidebarOpen),
        );
      },
      [sidebarOpen, sidebarWidth],
    ),
    useCallback(() => setResizingNotesPanel(false), []),
  );

  usePointerDragResize(
    resizingNotesListPane,
    useCallback(
      (event: PointerEvent) => {
        setNotesListPaneWidth(
          clampNotesListPaneWidth(event.clientX - notesListResizeLeftRef.current, notesPanelWidth),
        );
      },
      [notesPanelWidth],
    ),
    useCallback(() => setResizingNotesListPane(false), []),
  );

  useEffect(() => clearSidebarResizePress, [clearSidebarResizePress]);

  const rememberPaneSelection = useCallback((
    bridgeId: BridgeId,
    paneId: string,
    workspaceId?: string,
  ) => {
    setSelectedPanesByBridgeId((current) =>
      current[bridgeId] === paneId ? current : { ...current, [bridgeId]: paneId },
    );
    if (workspaceId) {
      setActiveWorkspacesByBridgeId((current) =>
        current[bridgeId] === workspaceId ? current : { ...current, [bridgeId]: workspaceId },
      );
    }
    if (selectedBridgeIdRef.current !== bridgeId) {
      return;
    }
    setSelectedPaneRefState((current) =>
      current?.bridgeId === bridgeId && current.paneId === paneId
        ? current
        : { bridgeId, paneId },
    );
    if (workspaceId) {
      setActiveWorkspaceRefState((current) =>
        current?.bridgeId === bridgeId && current.workspaceId === workspaceId
          ? current
        : { bridgeId, workspaceId },
      );
    }
  }, []);

  const applySharedPaneSelection = useCallback((
    bridgeId: BridgeId,
    paneId: string,
    workspaceId?: string,
  ) => {
    const pendingPaneId = pendingSharedPaneSelectionsRef.current[bridgeId]?.paneId;
    if (pendingPaneId && pendingPaneId !== paneId) {
      return;
    }
    if (pendingPaneId === paneId) {
      clearPendingSharedPaneSelection(bridgeId, paneId);
    }
    rememberPaneSelection(bridgeId, paneId, workspaceId);
  }, [clearPendingSharedPaneSelection, rememberPaneSelection]);

  const applyNavigationSyncMode = useCallback((mode: NavigationSyncMode) => {
    if (mode === "independent") {
      for (const bridgeId of Object.keys(pendingSharedPaneSelectionsRef.current)) {
        clearPendingSharedPaneSelection(bridgeId);
      }
    }
    if (mode === "shared" && selectedRuntime && snapshot?.selected_pane_id) {
      const pane = snapshot.panes.find(
        (candidate) => candidate.pane_id === snapshot.selected_pane_id,
      );
      if (pane) {
        rememberPaneSelection(selectedRuntime.id, pane.pane_id, pane.workspace_id);
      }
    }
    setNavigationSyncMode(mode);
  }, [
    clearPendingSharedPaneSelection,
    rememberPaneSelection,
    selectedRuntime,
    snapshot,
  ]);

  const changeNavigationSyncMode = useCallback((mode: NavigationSyncMode) => {
    persistNavigationSyncMode(mode);
    applyNavigationSyncMode(mode);
  }, [applyNavigationSyncMode]);

  useEffect(() => {
    const syncNavigationModeFromStorage = (event: StorageEvent) => {
      if (event.key !== NAVIGATION_SYNC_MODE_KEY) {
        return;
      }
      const mode = navigationSyncModeForStorageEvent(event.newValue);
      if (mode) {
        applyNavigationSyncMode(mode);
      }
    };
    window.addEventListener("storage", syncNavigationModeFromStorage);
    return () => window.removeEventListener("storage", syncNavigationModeFromStorage);
  }, [applyNavigationSyncMode]);

  useEffect(() => {
    const activeBridgeIds = new Set(bridge.enabledRuntimes.map((runtime) => runtime.id));
    const activeConnectionKeysByBridgeId = new Map(
      bridge.enabledRuntimes.map((runtime) => [runtime.id, runtime.connectionKey]),
    );

    for (const [bridgeId, entries] of Object.entries(pendingCreatedPaneNotesRef.current)) {
      const activeConnectionKey = activeConnectionKeysByBridgeId.get(bridgeId);
      const nextEntries = entries.filter((entry) => entry.connectionKey === activeConnectionKey);
      if (nextEntries.length > 0) {
        pendingCreatedPaneNotesRef.current[bridgeId] = nextEntries;
      } else {
        delete pendingCreatedPaneNotesRef.current[bridgeId];
      }
    }

    for (const [bridgeId, pending] of Object.entries(
      pendingSharedPaneSelectionsRef.current,
    )) {
      if (activeConnectionKeysByBridgeId.get(bridgeId) !== pending.connectionKey) {
        clearPendingSharedPaneSelection(bridgeId);
      }
    }

    for (const bridgeId of Object.keys(connectionRefs.current)) {
      if (!activeBridgeIds.has(bridgeId)) {
        delete connectionRefs.current[bridgeId];
      }
    }
    setConnectionStates((current) => {
      let changed = false;
      const next: Record<string, BridgeConnectionState> = {};
      for (const [bridgeId, state] of Object.entries(current)) {
        if (activeBridgeIds.has(bridgeId)) {
          next[bridgeId] = state;
        } else {
          changed = true;
        }
      }
      return changed ? next : current;
    });
    setAgentActivityStates((current) => {
      let changed = false;
      const next: Record<string, BridgeAgentActivityState> = {};
      for (const [bridgeId, state] of Object.entries(current)) {
        if (activeBridgeIds.has(bridgeId)) {
          next[bridgeId] = state;
        } else {
          changed = true;
        }
      }
      return changed ? next : current;
    });
    setNotesStates((current) => {
      let changed = false;
      const next: Record<string, BridgeNotesState> = {};
      for (const [bridgeId, state] of Object.entries(current)) {
        if (activeBridgeIds.has(bridgeId)) {
          next[bridgeId] = state;
        } else {
          changed = true;
        }
      }
      return changed ? next : current;
    });
    setAgentPinsStates((current) => {
      let changed = false;
      const next: Record<string, BridgeAgentPinsState> = {};
      for (const [bridgeId, state] of Object.entries(current)) {
        if (activeBridgeIds.has(bridgeId)) {
          next[bridgeId] = state;
        } else {
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [bridge.enabledRuntimes, clearPendingSharedPaneSelection]);

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
  const talkBack = useTalkBack(selectedPane ? resolvedPaneId : null);
  const selectedAgentPinsState =
    selectedRuntime &&
    agentPinsStates[selectedRuntime.id]?.connectionKey === selectedRuntime.connectionKey
      ? agentPinsStates[selectedRuntime.id]
      : null;
  const selectedPanePinsSupported = Boolean(
    selectedRuntime?.canConnect &&
      selectedRuntime.capabilityState === "ready" &&
      selectedPane &&
      supportsAgentPins(selectedRuntime.capabilities) &&
      selectedAgentPinsState?.response,
  );
  const selectedPanePinned =
    selectedRuntime && selectedPane
      ? isAgentPinned(pinnedAgentKeys, selectedRuntime.id, selectedPane.pane_id)
      : false;
  const selectedPanePinTarget = selectedPane && isAgentPane(selectedPane) ? "agent" : "pane";
  const selectedPanePinTitle = selectedPanePinned
    ? `Unpin ${selectedPanePinTarget}`
    : `Pin ${selectedPanePinTarget}`;
  const selectedNotesState =
    selectedRuntime && notesStates[selectedRuntime.id]?.connectionKey === selectedRuntime.connectionKey
      ? notesStates[selectedRuntime.id]
      : null;
  const selectedBridgeNotes = notesEnabled
    ? selectedNotesState?.response?.notes ?? EMPTY_PANE_NOTES
    : EMPTY_PANE_NOTES;
  const selectedPaneNotes = useMemo(
    () => notesForPane(selectedBridgeNotes, selectedPane?.pane_id),
    [selectedBridgeNotes, selectedPane?.pane_id],
  );
  const selectedRuntimeId = selectedRuntime?.id ?? null;
  const selectedPaneKey =
    notesEnabled && selectedRuntimeId && selectedPane
      ? `${selectedRuntimeId}:${selectedPane.pane_id}`
      : "";
  useEffect(() => {
    const paneChanged = selectedNotePaneKeyRef.current !== selectedPaneKey;
    selectedNotePaneKeyRef.current = selectedPaneKey;
    if (!selectedPaneKey || !selectedRuntimeId) {
      if (paneChanged) {
        setSelectedNoteRef(null);
      }
      return;
    }
    setSelectedNoteRef((current) => {
      const currentIsPaneNote =
        current?.bridgeId === selectedRuntimeId &&
        selectedPaneNotes.some((note) => note.note_id === current.noteId);
      if (currentIsPaneNote) {
        return current;
      }
      if (!paneChanged && current) {
        return current;
      }
      const firstNote = selectedPaneNotes[0] ?? null;
      return firstNote ? { bridgeId: selectedRuntimeId, noteId: firstNote.note_id } : null;
    });
  }, [selectedPaneKey, selectedPaneNotes, selectedRuntimeId]);
  const openSelectedPaneMenu = (x: number, y: number) => {
    if (selectedPane && selectedRuntime) {
      setMenu({
        kind: "pane",
        bridgeId: selectedRuntime.id,
        id: selectedPane.pane_id,
        label: paneTitle(selectedPane),
        x,
        y,
        pinLabel: isAgentPane(selectedPane) ? "agent" : "pane",
      });
    }
  };
  const selectedPaneMenuPress = useLongPress(openSelectedPaneMenu, openSelectedPaneMenu);

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
      (activeWorkspaceId &&
        snapshot.workspaces.find((workspace) => workspace.workspace_id === activeWorkspaceId)) ||
      (selectedPane &&
        snapshot.workspaces.find(
          (workspace) => workspace.workspace_id === selectedPane.workspace_id,
        )) ||
      snapshot.workspaces.find((workspace) => workspace.focused) ||
      snapshot.workspaces[0] ||
      null
    );
  }, [snapshot, activeWorkspaceId, selectedPane]);
  const visibleNotes = useMemo(
    () => {
      if (!notesEnabled) {
        return [];
      }
      return buildVisibleScopedNotes(
        bridgeViews,
        notesStates,
        selectedRuntime?.id ?? null,
        hostScope,
        scope,
        activeSpace,
        activeWorkspacesByBridgeId,
        multiHostSpaceSelection,
        notesIncludeArchived,
        notesIncludeDeleted,
      );
    },
    [
      activeSpace,
      activeWorkspacesByBridgeId,
      bridgeViews,
      hostScope,
      multiHostSpaceSelection,
      notesEnabled,
      notesStates,
      notesIncludeArchived,
      notesIncludeDeleted,
      scope,
      selectedRuntime?.id,
    ],
  );
  const allScopedNotes = useMemo(
    () => {
      if (!notesEnabled) {
        return [];
      }
      return buildVisibleScopedNotes(
        bridgeViews,
        notesStates,
        null,
        "all",
        "all",
        null,
        {},
        true,
        true,
        true,
        false,
      );
    },
    [bridgeViews, notesEnabled, notesStates],
  );
  const selectedScopedNote = useMemo(
    () => (selectedNoteRef ? findScopedNote(allScopedNotes, selectedNoteRef, false) : null),
    [allScopedNotes, selectedNoteRef],
  );

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

  // Shared navigation mirrors browser focus to Herdr so `active_tab_id` tracks
  // the synchronized view. Independent navigation deliberately leaves Herdr's
  // global focus alone. `tab.focus` also activates the tab's workspace.
  const publishSharedPaneSelection = (runtime: BridgeRuntime, paneId: string) => {
    clearPendingSharedPaneSelection(runtime.id);
    const refreshIfConnectionIsCurrent = () => {
      if (connectionRefs.current[runtime.id]?.connectionKey === runtime.connectionKey) {
        void refreshBridgeSnapshot(runtime, false);
      }
    };
    const timeoutId = window.setTimeout(() => {
      if (
        clearPendingSharedPaneSelection(runtime.id, paneId, runtime.connectionKey)
      ) {
        refreshIfConnectionIsCurrent();
      }
    }, SHARED_SELECTION_SETTLE_TIMEOUT_MS);
    pendingSharedPaneSelectionsRef.current[runtime.id] = {
      paneId,
      connectionKey: runtime.connectionKey,
      timeoutId,
    };
    void syncSelectedPane(runtime.httpUrl, paneId).catch(() => {
      if (
        clearPendingSharedPaneSelection(runtime.id, paneId, runtime.connectionKey)
      ) {
        refreshIfConnectionIsCurrent();
      }
    });
  };

  const pushFocus = (runtime: BridgeRuntime | null, tabId?: string, workspaceId?: string) => {
    if (!navigationIsShared || !runtime || runtime.capabilityState !== "ready") {
      return;
    }
    const commands = createCommands(runtime.httpUrl);
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

  const openPane = (bridgeId: BridgeId, pane: PaneInfo) => {
    const runtime = bridge.getRuntime(bridgeId);
    if (!runtime) {
      return;
    }
    setSelectedBridgeId(bridgeId);
    bridge.markBridgeUsed(bridgeId);
    rememberPaneSelection(bridgeId, pane.pane_id, pane.workspace_id);
    if (navigationIsShared && runtime.capabilityState === "ready") {
      publishSharedPaneSelection(runtime, pane.pane_id);
    }
    pushFocus(runtime, pane.tab_id, pane.workspace_id);
    if (isCompactLayout) {
      openMobileDetail();
    }
  };

  const paneSearchEntries = useMemo<PaneSearchEntry[]>(() => {
    const entries: PaneSearchEntry[] = [];
    for (const bridgeView of bridgeViews) {
      const snapshotData = bridgeView.snapshot;
      if (!snapshotData) continue;
      for (const pane of snapshotData.panes) {
        const workspace = snapshotData.workspaces.find((w) => w.workspace_id === pane.workspace_id);
        const tab = snapshotData.tabs.find((t) => t.tab_id === pane.tab_id);
        const path = workspace && tab ? `${workspace.label}/${tab.label}` : "unknown";
        entries.push({
          bridgeId: bridgeView.runtime.id,
          bridgeLabel: bridgeView.runtime.label,
          pane,
          path,
        });
      }
    }
    return entries;
  }, [bridgeViews]);

  const handlePaneSearchSelect = (bridgeId: BridgeId, pane: PaneInfo) => {
    setShowPaneSearch(false);
    openPane(bridgeId, pane);
  };

  const requestTerminalFocus = () => setTerminalFocusToken((token) => token + 1);
  const requestNoteTitleFocus = (bridgeId: BridgeId, noteId: string) => {
    setNoteTitleFocusRequest((current) => ({
      bridgeId,
      noteId,
      token: (current?.token ?? 0) + 1,
    }));
  };
  const clearNoteTitleFocusRequest = useCallback((request: ScopedNoteTitleFocusRequest) => {
    setNoteTitleFocusRequest((current) => (current?.token === request.token ? null : current));
  }, []);

  const snapshotForBridge = (bridgeId: BridgeId) => {
    const runtime = bridge.getRuntime(bridgeId);
    if (!runtime) {
      return null;
    }
    const ref = connectionRefs.current[bridgeId];
    if (ref?.connectionKey === runtime.connectionKey && ref.snapshot) {
      return ref.snapshot;
    }
    const state = connectionStates[bridgeId];
    return state?.connectionKey === runtime.connectionKey ? state.snapshot : null;
  };

  const selectSpace = (bridgeId: BridgeId, workspaceId: string) => {
    const runtime = bridge.getRuntime(bridgeId);
    if (!runtime) {
      return;
    }
    const bridgeSnapshot = snapshotForBridge(bridgeId);
    setSelectedBridgeId(bridgeId);
    bridge.markBridgeUsed(bridgeId);
    setActiveWorkspaceRefState({ bridgeId, workspaceId });
    setActiveWorkspacesByBridgeId((current) =>
      current[bridgeId] === workspaceId ? current : { ...current, [bridgeId]: workspaceId },
    );
    if (bridgeSnapshot) {
      const paneId = choosePaneForWorkspace(bridgeSnapshot, workspaceId);
      if (paneId) {
        const pane = bridgeSnapshot.panes.find((item) => item.pane_id === paneId);
        rememberPaneSelection(bridgeId, paneId, pane?.workspace_id ?? workspaceId);
        if (navigationIsShared && runtime.capabilityState === "ready") {
          publishSharedPaneSelection(runtime, paneId);
        }
        pushFocus(runtime, pane?.tab_id, workspaceId);
        return;
      }
      setSelectedPaneRefState(null);
    }
    pushFocus(runtime, undefined, workspaceId);
  };

  const selectTab = (bridgeId: BridgeId, tabId: string) => {
    const bridgeSnapshot = snapshotForBridge(bridgeId);
    if (!bridgeSnapshot) {
      return;
    }
    const paneId = choosePaneForTab(bridgeSnapshot, tabId);
    if (paneId) {
      const pane = bridgeSnapshot.panes.find((item) => item.pane_id === paneId);
      if (pane) {
        openPane(bridgeId, pane);
      }
    }
  };

  const focusTab = (bridgeId: BridgeId, tabId: string) => {
    selectTab(bridgeId, tabId);
    requestTerminalFocus();
  };

  const focusPane = (bridgeId: BridgeId, pane: PaneInfo) => {
    openPane(bridgeId, pane);
    requestTerminalFocus();
  };

  // Advance the selected agent pane by one visible entry, wrapping at the ends.
  // Shared by the desktop ArrowUp/ArrowDown shortcut and the mobile "next agent"/
  // "previous agent" command (parlay text/voice trigger). Reuses the same tested
  // `nextVisibleAgentPaneEntry` + `focusPane` path as the keyboard so mobile stays
  // in lockstep with desktop wrap behavior. Returns whether a pane was focused.
  const focusAdjacentAgentPane = (step: -1 | 1, pinnedOnlyOverride?: boolean): boolean => {
    const combineWorkspaceGroupsForShortcut =
      combineMatchingWorkspaceNames && hostScope === "all" && agentGroup === "workspace";
    const agentEntries = filterCollapsedAgentPaneEntries(
      buildVisibleAgentPaneEntries(
        buildVisibleScopedWorkspaces(
          bridgeViews,
          selectedRuntime?.id ?? null,
          hostScope,
          scope,
          activeSpace,
          activeWorkspacesByBridgeId,
          multiHostSpaceSelection,
        ),
        bridgeViews,
        hostScope,
        agentGroup,
        agentSort,
        pinnedAgentKeys,
        pinnedOnlyOverride ?? effectiveAgentPinnedOnly,
        agentActivityTransitions,
        agentActiveOnly,
        combineWorkspaceGroupsForShortcut,
      ),
      agentGroup,
      hostScope,
      combineWorkspaceGroupsForShortcut,
      collapsedSidebarGroupKeys,
    );
    if (agentEntries.length === 0) {
      return false;
    }
    const selectedBridgeIdForShortcut = selectedRuntime?.id ?? null;
    const currentIndex =
      selectedBridgeIdForShortcut && selectedPane
        ? agentEntries.findIndex(
            (entry) =>
              entry.bridgeId === selectedBridgeIdForShortcut &&
              entry.pane.pane_id === selectedPane.pane_id,
          )
        : -1;
    const next = nextVisibleAgentPaneEntry(agentEntries, currentIndex, step);
    focusPane(next.bridgeId, next.pane);
    return true;
  };

  // The mobile pin-cycle button hops between agents without opening the
  // sidebar. Tap cycles; long-press switches which pool it walks.
  const [paneCycleMode, setPaneCycleMode] = useState<"pin" | "all">("pin");

  const cycleAgentPane = (direction: "next" | "prev") => {
    const step = direction === "next" ? 1 : -1;
    // Pin mode falls back to every pane when nothing is pinned, so the button
    // never becomes a dead control.
    if (paneCycleMode === "pin" && focusAdjacentAgentPane(step, true)) {
      return;
    }
    focusAdjacentAgentPane(step, false);
  };

  const togglePaneCycleMode = () => {
    setPaneCycleMode((mode) => (mode === "pin" ? "all" : "pin"));
  };

  const selectNote = (bridgeId: BridgeId, noteId: string) => {
    if (!notesEnabled) {
      return;
    }
    setSelectedNoteRef({ bridgeId, noteId });
    if (isCompactLayout) {
      setMobileNotesScreen("editor");
    }
    setNotesPanelOpen(true);
  };

  const openNotesPanel = () => {
    if (!notesEnabled) {
      return;
    }
    if (notesPanelOpen) {
      setNotesPanelOpen(false);
      return;
    }
    const selectedNoteIsCurrentPaneNote =
      selectedScopedNote &&
      selectedRuntime &&
      selectedScopedNote.bridgeId === selectedRuntime.id &&
      selectedPaneNotes.some((note) => note.note_id === selectedScopedNote.note.note_id);
    const firstPaneNote = selectedPaneNotes[0] ?? null;
    const noteToOpen = selectedNoteIsCurrentPaneNote ? selectedScopedNote.note : firstPaneNote;
    if (selectedRuntime && noteToOpen) {
      setSelectedNoteRef({
        bridgeId: selectedRuntime.id,
        noteId: noteToOpen.note_id,
      });
    }
    setMobileNotesScreen(isCompactLayout && noteToOpen ? "editor" : "list");
    setNotesPanelOpen(true);
  };

  const createNoteForCurrentPane = async () => {
    if (!notesEnabled) {
      setError("Notes are disabled in settings");
      return;
    }
    if (!selectedRuntime || !selectedPane || !supportsNotes(selectedRuntime.capabilities)) {
      setError("Notes are not available for this bridge");
      return;
    }
    try {
      const note = await createNote(selectedRuntime.httpUrl, {
        title: "Untitled note",
        body: "",
        paneId: selectedPane.pane_id,
      });
      setSelectedNoteRef({ bridgeId: selectedRuntime.id, noteId: note.note_id });
      requestNoteTitleFocus(selectedRuntime.id, note.note_id);
      if (isCompactLayout) {
        setMobileNotesScreen("editor");
      }
      setNotesPanelOpen(true);
      await refreshBridgeNotes(selectedRuntime, false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create note");
    }
  };

  const createDetachedBridgeNote = async (bridgeId = selectedRuntime?.id ?? null) => {
    if (!notesEnabled) {
      setError("Notes are disabled in settings");
      return;
    }
    const runtime = bridgeId ? bridge.getRuntime(bridgeId) : null;
    if (!runtime || !supportsNotes(runtime.capabilities)) {
      setError("Notes are not available for this bridge");
      return;
    }
    try {
      const note = await createNote(runtime.httpUrl, {
        title: "Untitled note",
        body: "",
      });
      setSelectedNoteRef({ bridgeId: runtime.id, noteId: note.note_id });
      requestNoteTitleFocus(runtime.id, note.note_id);
      if (isCompactLayout) {
        setMobileNotesScreen("editor");
      }
      setNotesPanelOpen(true);
      await refreshBridgeNotes(runtime, false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create note");
    }
  };

  const setPendingCreatedPaneNotesForConnection = (
    bridgeId: BridgeId,
    connectionKey: string,
    entries: readonly PendingCreatedPaneNoteTarget[],
  ) => {
    const current = pendingCreatedPaneNotesRef.current[bridgeId] ?? [];
    const next = [
      ...current.filter((entry) => entry.connectionKey !== connectionKey),
      ...entries.map((entry) => ({ ...entry, connectionKey })),
    ].slice(-MAX_PENDING_CREATED_PANE_NOTES);
    if (next.length > 0) {
      pendingCreatedPaneNotesRef.current[bridgeId] = next;
    } else {
      delete pendingCreatedPaneNotesRef.current[bridgeId];
    }
  };

  const rememberPendingCreatedPaneNote = (
    bridgeId: BridgeId,
    connectionKey: string,
    note: PaneNote,
    pane: PaneInfo,
  ) => {
    const current = pendingCreatedPaneNotesRef.current[bridgeId] ?? [];
    setPendingCreatedPaneNotesForConnection(
      bridgeId,
      connectionKey,
      [
        ...current.filter(
          (entry) => entry.connectionKey === connectionKey && entry.note.note_id !== note.note_id,
        ),
        { note, pane },
      ],
    );
  };

  const mergePendingCreatedPaneNotesForResponse = (
    bridgeId: BridgeId,
    connectionKey: string,
    response: NotesListResponse,
  ) => {
    const pending = (pendingCreatedPaneNotesRef.current[bridgeId] ?? []).filter(
      (entry) => entry.connectionKey === connectionKey,
    );
    if (pending.length === 0) {
      return response;
    }
    const merged = mergePendingPaneNotesIntoList(response.notes, pending);
    setPendingCreatedPaneNotesForConnection(bridgeId, connectionKey, merged.pending);
    return {
      ...response,
      notes: merged.notes,
    };
  };

  const openQuickPaneNoteDialog = (bridgeId: BridgeId, paneId: string, label: string) => {
    if (!notesEnabled) {
      setError("Notes are disabled in settings");
      return;
    }
    const runtime = bridge.getRuntime(bridgeId);
    if (
      !runtime ||
      !runtime.canConnect ||
      runtime.capabilityState !== "ready" ||
      !supportsNotes(runtime.capabilities)
    ) {
      setError("Notes are not available for this bridge");
      return;
    }
    const bridgeSnapshot = snapshotForBridge(bridgeId);
    const targetPane = bridgeSnapshot?.panes.find((pane) => pane.pane_id === paneId) ?? null;
    if (!targetPane) {
      setError("Pane not found");
      return;
    }
    setQuickPaneNoteTarget({
      bridgeId,
      paneId,
      label: label || paneTitle(targetPane),
    });
    setError(null);
  };

  const createQuickPaneNote = async (title: string, body: string) => {
    const target = quickPaneNoteTarget;
    if (!target) {
      return;
    }
    if (!notesEnabled) {
      setError("Notes are disabled in settings");
      return;
    }
    const runtime = bridge.getRuntime(target.bridgeId);
    if (
      !runtime ||
      !runtime.canConnect ||
      runtime.capabilityState !== "ready" ||
      !supportsNotes(runtime.capabilities)
    ) {
      setError("Notes are not available for this bridge");
      return;
    }
    const bridgeSnapshot = snapshotForBridge(target.bridgeId);
    const targetPane = bridgeSnapshot?.panes.find((pane) => pane.pane_id === target.paneId) ?? null;
    if (!targetPane) {
      setError("Pane not found");
      return;
    }
    const requestConnectionKey = runtime.connectionKey;
    const isCurrentConnection = () => {
      const currentRuntime = bridge.getRuntime(target.bridgeId);
      return Boolean(
        notesEnabledRef.current &&
          currentRuntime?.connectionKey === requestConnectionKey &&
          isConnectionResultCurrent(
            connectionRefs.current[target.bridgeId]?.connectionKey ?? "",
            requestConnectionKey,
          ),
      );
    };
    setQuickPaneNoteCreating(true);
    try {
      const note = await createNote(runtime.httpUrl, {
        title,
        body,
        paneId: targetPane.pane_id,
      });
      setQuickPaneNoteTarget((current) =>
        current?.bridgeId === target.bridgeId && current.paneId === target.paneId ? null : current,
      );
      try {
        const response = await refreshBridgeNotes(runtime, false);
        if (!isCurrentConnection()) {
          return;
        }
        if (!response || !noteListContainsId(response.notes, note.note_id)) {
          mergeCreatedPaneNote(target.bridgeId, requestConnectionKey, note, targetPane, Boolean(response));
        }
      } catch (caught) {
        if (isCurrentConnection()) {
          const detail = caught instanceof Error ? caught.message : "unknown refresh error";
          setError(`Note created, but notes did not refresh: ${detail}`);
        }
        return;
      }
      setError(null);
    } catch (caught) {
      if (isCurrentConnection()) {
        setError(caught instanceof Error ? caught.message : "Could not create note");
      }
    } finally {
      setQuickPaneNoteCreating(false);
    }
  };

  const mergeCreatedPaneNote = (
    bridgeId: BridgeId,
    connectionKey: string,
    note: PaneNote,
    pane: PaneInfo,
    refreshSucceeded: boolean,
  ) => {
    rememberPendingCreatedPaneNote(bridgeId, connectionKey, note, pane);
    setNotesStates((current) => {
      const state = current[bridgeId];
      if (state && state.connectionKey !== connectionKey) {
        return current;
      }
      const response = state?.response ?? {
        store_id: `${bridgeId}:optimistic`,
        session_key: note.session_key,
        notes: [],
      };
      const notes = mergeCreatedPaneNoteList(response.notes, note, pane);
      return {
        ...current,
        [bridgeId]: {
          connectionKey,
          response: {
            ...response,
            notes,
          },
          loadState: refreshSucceeded ? "ready" : (state?.loadState ?? "ready"),
          error: refreshSucceeded ? null : (state?.error ?? null),
        },
      };
    });
  };

  const saveScopedNote = async (
    entry: ScopedNoteEntry,
    title: string,
    body: string,
    expectedRevision: number,
  ) => {
    const runtime = bridge.getRuntime(entry.bridgeId);
    if (!runtime) {
      setError("Bridge is not ready");
      throw new Error("Bridge is not ready");
    }
    try {
      const savedNote = await updateNote(runtime.httpUrl, entry.note.note_id, {
        title,
        body,
        expectedRevision,
      });
      await refreshBridgeNotes(runtime, false);
      return savedNote.revision;
    } catch (caught) {
      setError(
        isNotesConflictError(caught)
          ? "Note changed in another client"
          : caught instanceof Error
            ? caught.message
            : "Could not save note",
      );
      await refreshBridgeNotes(runtime, false);
      throw caught;
    }
  };

  const attachScopedNoteToCurrentPane = async (entry: ScopedNoteEntry) => {
    if (!selectedRuntime || !selectedPane || selectedRuntime.id !== entry.bridgeId) {
      setError("Select a pane on the same bridge first");
      return;
    }
    try {
      await attachNote(selectedRuntime.httpUrl, entry.note.note_id, {
        paneId: selectedPane.pane_id,
        expectedRevision: entry.note.revision,
      });
      await refreshBridgeNotes(selectedRuntime, false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not attach note");
    }
  };

  const detachScopedNote = async (entry: ScopedNoteEntry) => {
    const runtime = bridge.getRuntime(entry.bridgeId);
    if (!runtime) {
      setError("Bridge is not ready");
      return;
    }
    try {
      await detachNote(runtime.httpUrl, entry.note.note_id, {
        expectedRevision: entry.note.revision,
      });
      await refreshBridgeNotes(runtime, false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not detach note");
    }
  };

  const archiveScopedNote = async (entry: ScopedNoteEntry) => {
    const runtime = bridge.getRuntime(entry.bridgeId);
    if (!runtime) {
      setError("Bridge is not ready");
      return;
    }
    try {
      await archiveNote(runtime.httpUrl, entry.note.note_id, {
        expectedRevision: entry.note.revision,
      });
      await refreshBridgeNotes(runtime, false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not archive note");
    }
  };

  const restoreScopedNote = async (entry: ScopedNoteEntry) => {
    const runtime = bridge.getRuntime(entry.bridgeId);
    if (!runtime) {
      setError("Bridge is not ready");
      return;
    }
    try {
      await restoreNote(runtime.httpUrl, entry.note.note_id, {
        expectedRevision: entry.note.revision,
      });
      await refreshBridgeNotes(runtime, false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not restore note");
    }
  };

  const deleteScopedNote = async (entry: ScopedNoteEntry) => {
    const runtime = bridge.getRuntime(entry.bridgeId);
    if (!runtime) {
      setError("Bridge is not ready");
      return false;
    }
    try {
      await deleteNote(runtime.httpUrl, entry.note.note_id, {
        expectedRevision: entry.note.revision,
      });
      clearNoteDraft(entry);
      const deletedSelected =
        selectedNoteRef?.bridgeId === entry.bridgeId &&
        selectedNoteRef.noteId === entry.note.note_id;
      if (deletedSelected) {
        setSelectedNoteRef(null);
      }
      const response = await refreshBridgeNotes(runtime, false);
      if (deletedSelected && selectedRuntime?.id === runtime.id && selectedPane) {
        const nextPaneNote = notesForPane(response?.notes ?? [], selectedPane.pane_id).find(
          (note) => note.note_id !== entry.note.note_id,
        );
        setSelectedNoteRef(
          nextPaneNote ? { bridgeId: runtime.id, noteId: nextPaneNote.note_id } : null,
        );
      }
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete note");
      return false;
    }
  };

  const confirmDeleteNote = async () => {
    if (!noteDeleteTarget) {
      return;
    }
    setDeletingNote(true);
    try {
      if (await deleteScopedNote(noteDeleteTarget)) {
        setNoteDeleteTarget(null);
      }
    } finally {
      setDeletingNote(false);
    }
  };

  const viewScopedNotePane = (entry: ScopedNoteEntry) => {
    if (!entry.pane) {
      setError("That note is not linked to an open pane");
      return;
    }
    openPane(entry.bridgeId, entry.pane);
    if (isCompactLayout) {
      setMobileNotesScreen("list");
      setNotesPanelOpen(false);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const navigationShortcut = isAppNavigationShortcut(event);
      const closeTabShortcut = isCloseTabShortcut(event);
      const newTabShortcut = isNewTabShortcut(event);
      const splitDirection = splitSupported ? splitShortcutDirection(event) : null;
      const paneFocusDirection =
        paneFocusSupported || !navigationIsShared
          ? paneFocusShortcutDirection(event)
          : null;
      const paneCycleStep = paneCycleShortcutStep(event);
      if (
        (!navigationShortcut &&
          !closeTabShortcut &&
          !newTabShortcut &&
          !splitDirection &&
          !paneFocusDirection &&
          paneCycleStep === 0) ||
        isShortcutTextEntryTarget(event.target) ||
        busy ||
        menu ||
        dialog ||
        launchTarget ||
        hasOpenModal()
      ) {
        return;
      }

      if (paneFocusDirection) {
        if (!selectedPane || !selectedRuntime) {
          return;
        }
        if (!navigationIsShared) {
          const nextPane = snapshot
            ? chooseDirectionalPane(snapshot, selectedPane.pane_id, paneFocusDirection)
            : null;
          event.preventDefault();
          event.stopPropagation();
          if (!nextPane) {
            return;
          }
          focusPane(selectedRuntime.id, nextPane);
          return;
        }
        if (!selectedCommands) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        void exec(
          selectedRuntime,
          () => selectedCommands.focusPaneDirection(selectedPane.pane_id, paneFocusDirection),
          true,
        ).then((ok) => ok && requestTerminalFocus());
        return;
      }

      if (paneCycleStep !== 0) {
        if (!snapshot || !selectedRuntime) {
          return;
        }
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
        if (selectedRuntime) {
          focusPane(selectedRuntime.id, panes[nextIndex]);
        }
        return;
      }

      if (splitDirection) {
        if (!selectedPane || !selectedCommands) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        void exec(
          selectedRuntime,
          () => selectedCommands.splitPane(selectedPane.pane_id, splitDirection),
          true,
        ).then((ok) => ok && requestTerminalFocus());
        return;
      }

      if (newTabShortcut) {
        if (!selectedRuntime) {
          return;
        }
        if (!activeSpace) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (selectedRuntime) {
          setLaunchTarget({
            mode: "tab",
            workspaceId: activeSpace.workspace_id,
            bridgeId: selectedRuntime.id,
          });
        }
        return;
      }

      if (closeTabShortcut) {
        if (!snapshot || !selectedRuntime) {
          return;
        }
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
            bridgeId: selectedRuntime.id,
            id: selectedPane.pane_id,
            label: paneTitle(selectedPane),
          });
          return;
        }
        setDialog({
          mode: "close",
          kind: "tab",
          bridgeId: selectedRuntime.id,
          id: tab.tab_id,
          label: displayTabLabel(tab, snapshot.panes),
        });
        return;
      }

      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        const step = event.key === "ArrowDown" ? 1 : -1;
        if (focusAdjacentAgentPane(step)) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }
      const combineWorkspaceGroupsForShortcut =
        combineMatchingWorkspaceNames && hostScope === "all" && agentGroup === "workspace";
      const tabEntries = filterCollapsedTabEntries(
        buildVisibleTabEntries(
          buildVisibleScopedWorkspaces(
            bridgeViews,
            selectedRuntime?.id ?? null,
            hostScope,
            scope,
            activeSpace,
            activeWorkspacesByBridgeId,
            multiHostSpaceSelection,
          ),
          bridgeViews,
          hostScope,
          agentGroup,
          pinnedAgentKeys,
          sidebarView === "tabs" && effectiveAgentPinnedOnly,
          sidebarView === "tabs" && agentFeaturesInTabs,
          agentSort,
          agentActivityTransitions,
          sidebarView === "tabs" && agentFeaturesInTabs && agentActiveOnly,
          combineWorkspaceGroupsForShortcut,
        ),
        agentGroup,
        hostScope,
        combineWorkspaceGroupsForShortcut,
        collapsedSidebarGroupKeys,
      );
      const tabs = tabEntries;
      if (tabs.length === 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const selectedBridgeIdForShortcut = selectedRuntime?.id ?? null;
      const currentIndex = tabs.findIndex((entry) => {
        if (!selectedBridgeIdForShortcut || entry.bridgeId !== selectedBridgeIdForShortcut) {
          return false;
        }
        if (selectedPane) {
          return entry.tab.tab_id === selectedPane.tab_id;
        }
        return (
          activeSpace?.workspace_id === entry.workspace.workspace_id &&
          entry.tab.tab_id === activeSpace.active_tab_id
        );
      });
      const step = event.key === "ArrowRight" ? 1 : -1;
      const next = nextVisibleTabEntry(tabs, currentIndex, step);
      focusTab(next.bridgeId, next.tab.tab_id);
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [
    activeSpace,
    activeWorkspacesByBridgeId,
    agentActivityTransitions,
    agentActiveOnly,
    agentFeaturesInTabs,
    effectiveAgentPinnedOnly,
    agentGroup,
    agentSort,
    combineMatchingWorkspaceNames,
    collapsedSidebarGroupKeys,
    bridgeViews,
    busy,
    dialog,
    hostScope,
    isCompactLayout,
    launchTarget,
    menu,
    multiHostSpaceSelection,
    navigationIsShared,
    paneFocusSupported,
    pinnedAgentKeys,
    scope,
    sidebarView,
    selectedPane,
    selectedRuntime,
    selectedCommands,
    splitSupported,
    snapshot,
  ]);

  const refreshNow = () => {
    const connectableRuntimes = bridge.enabledRuntimes.filter((runtime) => runtime.canConnect);
    if (connectableRuntimes.length === 0) {
      setBackendSettingsOpen(true);
      return;
    }
    for (const runtime of connectableRuntimes) {
      void refreshBridgeSnapshot(runtime, true);
    }
  };

  async function refreshBridgeSnapshot(runtime: BridgeRuntime, setLoading: boolean) {
    const ref = ensureBridgeConnectionRef(connectionRefs, runtime);
    const requestConnectionKey = runtime.connectionKey;
    const refreshGeneration = ref.activityGeneration;
    if (setLoading) {
      setConnectionStates((current) => ({
        ...current,
        [runtime.id]: {
          connectionKey: requestConnectionKey,
          snapshot: current[runtime.id]?.snapshot ?? null,
          loadState: "loading",
        },
      }));
    }
    try {
      const next = await fetchSnapshot(runtime.httpUrl);
      const currentRef = connectionRefs.current[runtime.id];
      if (
        !currentRef ||
        !isConnectionResultCurrent(currentRef.connectionKey, requestConnectionKey)
      ) {
        return null;
      }
      if (currentRef.resyncBarrierGeneration > refreshGeneration) {
        return refreshBridgeSnapshot(runtime, false);
      }
      const patched = applySnapshotOverlays(next, currentRef, refreshGeneration);
      currentRef.snapshot = patched;
      setConnectionStates((current) => ({
        ...current,
        [runtime.id]: {
          connectionKey: requestConnectionKey,
          snapshot: patched,
          loadState: "ready",
        },
      }));
      return patched;
    } catch {
      const currentRef = connectionRefs.current[runtime.id];
      if (currentRef?.connectionKey === requestConnectionKey) {
        setConnectionStates((current) => ({
          ...current,
          [runtime.id]: {
            connectionKey: requestConnectionKey,
            snapshot: current[runtime.id]?.snapshot ?? null,
            loadState: "error",
          },
        }));
      }
      return null;
    }
  }

  async function refreshBridgeResource<Resource>(options: {
    runtime: BridgeRuntime;
    setLoading: boolean;
    supported: boolean;
    setState: Dispatch<SetStateAction<Record<string, BridgeResourceState<Resource>>>>;
    fetchResponse: () => Promise<Resource>;
    fallbackError: string;
    isEnabled?: () => boolean;
    transformResponse?: (response: Resource, requestConnectionKey: string) => Resource;
  }): Promise<Resource | null> {
    const { runtime, setLoading, supported, setState, fetchResponse, fallbackError } = options;
    ensureBridgeConnectionRef(connectionRefs, runtime);
    const requestConnectionKey = runtime.connectionKey;
    const isCurrentConnection = () =>
      isConnectionResultCurrent(
        connectionRefs.current[runtime.id]?.connectionKey ?? "",
        requestConnectionKey,
      );
    if (!runtime.canConnect || runtime.capabilityState !== "ready" || !supported) {
      setState((current) => ({
        ...current,
        [runtime.id]: {
          connectionKey: requestConnectionKey,
          response: null,
          loadState: "ready",
          error: null,
        },
      }));
      return null;
    }
    if (setLoading) {
      setState((current) => ({
        ...current,
        [runtime.id]: {
          connectionKey: requestConnectionKey,
          response:
            current[runtime.id]?.connectionKey === requestConnectionKey
              ? current[runtime.id]?.response ?? null
              : null,
          loadState: "loading",
          error: null,
        },
      }));
    }
    try {
      const response = (await fetchResponse()) as Resource;
      if (options.isEnabled && !options.isEnabled()) {
        return null;
      }
      let effectiveResponse = response;
      if (options.transformResponse) {
        if (!isCurrentConnection()) {
          return null;
        }
        effectiveResponse = options.transformResponse(response, requestConnectionKey);
      }
      setState((current) => {
        if (!isCurrentConnection()) {
          return current;
        }
        return {
          ...current,
          [runtime.id]: {
            connectionKey: requestConnectionKey,
            response: effectiveResponse,
            loadState: "ready",
            error: null,
          },
        };
      });
      return effectiveResponse;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : fallbackError;
      if (options.isEnabled && !options.isEnabled()) {
        return null;
      }
      if (!isCurrentConnection()) {
        return null;
      }
      setState((current) => ({
        ...current,
        [runtime.id]: {
          connectionKey: requestConnectionKey,
          response:
            current[runtime.id]?.connectionKey === requestConnectionKey
              ? current[runtime.id]?.response ?? null
              : null,
          loadState: "error",
          error: message,
        },
      }));
      return null;
    }
  }

  async function refreshBridgeAgentActivity(runtime: BridgeRuntime, setLoading: boolean) {
    return refreshBridgeResource({
      runtime,
      setLoading,
      supported: supportsAgentActivity(runtime.capabilities),
      setState: setAgentActivityStates,
      fetchResponse: () => fetchAgentActivity(runtime.httpUrl),
      fallbackError: "Agent activity unavailable",
    });
  }

  const refreshAgentActivityForBridge = (bridgeId: BridgeId) => {
    const runtime = bridge.getRuntime(bridgeId);
    if (runtime) {
      void refreshBridgeAgentActivity(runtime, false);
    }
  };

  useEffect(() => {
    for (const runtime of bridge.enabledRuntimes) {
      if (runtime.capabilityState === "ready" && supportsAgentActivity(runtime.capabilities)) {
        void refreshBridgeAgentActivity(runtime, true);
      }
    }
  }, [bridge.enabledRuntimes]);

  async function refreshBridgeAgentPins(runtime: BridgeRuntime, setLoading: boolean) {
    return refreshBridgeResource({
      runtime,
      setLoading,
      supported: supportsAgentPins(runtime.capabilities),
      setState: setAgentPinsStates,
      fetchResponse: () => fetchAgentPins(runtime.httpUrl),
      fallbackError: "Agent pins unavailable",
    });
  }

  const refreshAgentPinsForBridge = (bridgeId: BridgeId) => {
    const runtime = bridge.getRuntime(bridgeId);
    if (runtime) {
      void refreshBridgeAgentPins(runtime, false);
    }
  };

  useEffect(() => {
    for (const runtime of bridge.enabledRuntimes) {
      if (runtime.capabilityState === "ready" && supportsAgentPins(runtime.capabilities)) {
        void refreshBridgeAgentPins(runtime, true);
      }
    }
  }, [bridge.enabledRuntimes]);

  async function refreshBridgeNotes(runtime: BridgeRuntime, setLoading: boolean) {
    return refreshBridgeResource({
      runtime,
      setLoading,
      supported: notesEnabled && supportsNotes(runtime.capabilities),
      setState: setNotesStates,
      fetchResponse: () =>
        fetchNotes(runtime.httpUrl, {
          includeArchived: true,
          includeDeleted: true,
          includeOtherSessions: true,
        }),
      fallbackError: "Notes unavailable",
      isEnabled: () => notesEnabledRef.current,
      transformResponse: (response, requestConnectionKey) =>
        mergePendingCreatedPaneNotesForResponse(runtime.id, requestConnectionKey, response),
    });
  }

  const refreshNotesForBridge = (bridgeId: BridgeId) => {
    if (!notesEnabled) {
      return;
    }
    const runtime = bridge.getRuntime(bridgeId);
    if (runtime) {
      void refreshBridgeNotes(runtime, false);
    }
  };

  useEffect(() => {
    if (!notesEnabled) {
      return;
    }
    for (const runtime of bridge.enabledRuntimes) {
      if (runtime.capabilityState === "ready" && supportsNotes(runtime.capabilities)) {
        void refreshBridgeNotes(runtime, true);
      }
    }
  }, [bridge.enabledRuntimes, notesEnabled]);

  useEffect(() => {
    if (!notesEnabled) {
      return;
    }
    if (!notesPanelOpen && sidebarView !== "notes") {
      return;
    }
    const refresh = () => {
      for (const runtime of bridge.enabledRuntimes) {
        if (runtime.capabilityState === "ready" && supportsNotes(runtime.capabilities)) {
          void refreshBridgeNotes(runtime, false);
        }
      }
    };
    const timer = window.setInterval(refresh, NOTES_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [bridge.enabledRuntimes, notesEnabled, notesPanelOpen, sidebarView]);

  async function exec(
    runtime: BridgeRuntime | null,
    action: () => Promise<{ [key: string]: unknown }>,
    selectCreated = false,
  ) {
    if (
      !runtime ||
      runtime.capabilityState !== "ready" ||
      !runtime.canConnect ||
      !connectionRefs.current[runtime.id]?.snapshot
    ) {
      setError("Bridge is not ready");
      return false;
    }
    const requestConnectionKey = runtime.connectionKey;
    setBusy(true);
    try {
      const result = await action();
      let ref = connectionRefs.current[runtime.id];
      let refreshGeneration = ref?.activityGeneration ?? 0;
      let next = await fetchSnapshot(runtime.httpUrl);
      while (ref && ref.resyncBarrierGeneration > refreshGeneration) {
        refreshGeneration = ref.activityGeneration;
        next = await fetchSnapshot(runtime.httpUrl);
        ref = connectionRefs.current[runtime.id];
      }
      if (!ref || !isConnectionResultCurrent(ref.connectionKey, requestConnectionKey)) {
        return false;
      }
      const patched = applySnapshotOverlays(next, ref, refreshGeneration);
      ref.snapshot = patched;
      setConnectionStates((current) => ({
        ...current,
        [runtime.id]: {
          connectionKey: requestConnectionKey,
          snapshot: patched,
          loadState: "ready",
        },
      }));
      if (selectCreated) {
        const paneId = createdPaneId(result);
        const created = paneId ? patched.panes.find((pane) => pane.pane_id === paneId) : undefined;
        if (created) {
          setSelectedBridgeId(runtime.id);
          rememberPaneSelection(runtime.id, created.pane_id, created.workspace_id);
          if (navigationIsShared) {
            publishSharedPaneSelection(runtime, created.pane_id);
          }
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

  async function reorderSpace(
    bridgeId: BridgeId,
    sourceWorkspaceId: string,
    beforeWorkspaceId: string | null,
    keepMode = false,
  ): Promise<boolean> {
    const runtime = bridge.getRuntime(bridgeId);
    const snapshot = connectionRefs.current[bridgeId]?.snapshot;
    const params = snapshot
      ? workspaceMoveBlockParams(snapshot.workspaces, sourceWorkspaceId, beforeWorkspaceId)
      : null;
    if (
      !runtime ||
      !snapshot ||
      !runtime.canConnect ||
      runtime.capabilityState !== "ready" ||
      !runtime.capabilities?.commands.includes("workspace.move_block")
    ) {
      setError("Space ordering is unavailable");
      closeSpaceReorder();
      return false;
    }
    if (!params) {
      closeSpaceReorder();
      return false;
    }
    const commands = createCommands(runtime.httpUrl);
    const moved = await exec(runtime, () =>
      commands.moveWorkspaceBlock(params.workspaceIds, params.beforeWorkspaceId),
    );
    if (!keepMode || !moved) {
      closeSpaceReorder();
    }
    return moved;
  }

  async function toggleAgentPin(bridgeId: BridgeId, paneId: string, pinned: boolean) {
    const runtime = bridge.getRuntime(bridgeId);
    if (
      !runtime ||
      !runtime.canConnect ||
      runtime.capabilityState !== "ready" ||
      !supportsAgentPins(runtime.capabilities)
    ) {
      setError("Agent pins are unavailable");
      return;
    }
    const requestConnectionKey = runtime.connectionKey;
    try {
      const response = pinned
        ? await unpinAgent(runtime.httpUrl, paneId)
        : await pinAgent(runtime.httpUrl, paneId);
      setAgentPinsStates((current) => ({
        ...current,
        [runtime.id]: {
          connectionKey: requestConnectionKey,
          response,
          loadState: "ready",
          error: null,
        },
      }));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update agent pin");
    }
  }

  const onMenuPick = (key: string) => {
    if (!menu) {
      return;
    }
    const { kind, bridgeId, id, label, clearable } = menu;
    const runtime = bridge.getRuntime(bridgeId);
    const commands = runtime ? createCommands(runtime.httpUrl) : null;
    setMenu(null);
    if (key === "rename") {
      setDialog({ mode: "rename", kind, bridgeId, id, label, clearable });
    } else if (key === "close") {
      setDialog({ mode: "close", kind, bridgeId, id, label });
    } else if (key === "newtab") {
      setSelectedBridgeId(bridgeId);
      setActiveWorkspaceRefState({ bridgeId, workspaceId: id });
      setActiveWorkspacesByBridgeId((current) =>
        current[bridgeId] === id ? current : { ...current, [bridgeId]: id },
      );
      setLaunchTarget({ mode: "tab", workspaceId: id, bridgeId });
    } else if (key === "reorder" && kind === "space") {
      setSpaceReorderMode({ bridgeId, workspaceId: id });
    } else if (key === "pin" && kind === "pane") {
      void toggleAgentPin(bridgeId, id, false);
    } else if (key === "unpin" && kind === "pane") {
      void toggleAgentPin(bridgeId, id, true);
    } else if (key === "add_note" && kind === "pane") {
      openQuickPaneNoteDialog(bridgeId, id, label);
    } else if (key === "move_new_tab" && kind === "pane") {
      const pane = connectionRefs.current[bridgeId]?.snapshot?.panes.find(
        (item) => item.pane_id === id,
      );
      if (!pane || !commands) {
        setError("Pane not found");
        return;
      }
      void exec(runtime, () => commands.movePaneToNewTab(id, pane.workspace_id, label), true);
    } else if (key === "move_new_space" && kind === "pane") {
      if (!commands) {
        setError("Bridge is not ready");
        return;
      }
      void exec(runtime, () => commands.movePaneToNewWorkspace(id, label), true);
    }
  };

  const submitRename = (value: string) => {
    if (!dialog) {
      return;
    }
    const { kind, bridgeId, id } = dialog;
    const runtime = bridge.getRuntime(bridgeId);
    const commands = runtime ? createCommands(runtime.httpUrl) : null;
    if (!commands) {
      setError("Bridge is not ready");
      return;
    }
    const action =
      kind === "space"
        ? () => commands.renameWorkspace(id, value)
        : kind === "tab"
          ? () => commands.renameTab(id, value)
          : () => commands.renamePane(id, value);
    void exec(runtime, action).then((ok) => ok && setDialog(null));
  };

  const clearRename = () => {
    if (!dialog || dialog.kind === "pane") {
      return;
    }
    const { kind, bridgeId, id } = dialog;
    const runtime = bridge.getRuntime(bridgeId);
    const commands = runtime ? createCommands(runtime.httpUrl) : null;
    if (!commands) {
      setError("Bridge is not ready");
      return;
    }
    const action =
      kind === "space"
        ? () => commands.renameWorkspace(id, null)
        : () => commands.renameTab(id, null);
    void exec(runtime, action).then((ok) => ok && setDialog(null));
  };

  const confirmClose = () => {
    if (!dialog) {
      return;
    }
    const { kind, bridgeId, id } = dialog;
    const runtime = bridge.getRuntime(bridgeId);
    const commands = runtime ? createCommands(runtime.httpUrl) : null;
    if (!commands) {
      setError("Bridge is not ready");
      return;
    }
    const action =
      kind === "space"
        ? () => commands.closeWorkspace(id)
        : kind === "tab"
          ? () => commands.closeTab(id)
          : () => commands.closePane(id);
    void exec(runtime, action).then((ok) => ok && setDialog(null));
  };

  const submitLaunch = (spec: LaunchSpec) => {
    if (!launchTarget) {
      return;
    }
    const runtime = bridge.getRuntime(launchTarget.bridgeId);
    const commands = runtime ? createCommands(runtime.httpUrl) : null;
    if (!runtime || !commands) {
      setError("Bridge is not ready");
      return;
    }
    if (!supportsLauncherPresets(runtime.capabilities)) {
      setError("Launching is unavailable on this bridge. Update the bridge and reconnect.");
      return;
    }
    if (!launchPresetState?.response) {
      setError(launchEmptyMessage ?? "Launcher presets are unavailable");
      return;
    }
    if (!launchPresetState.response.presets.some((preset) => preset.id === spec.presetId)) {
      setError("That launcher preset is no longer available. Close and reopen the launcher.");
      return;
    }
    const launchSnapshot =
      connectionRefs.current[launchTarget.bridgeId]?.snapshot ??
      (launchTarget.bridgeId === selectedRuntime?.id ? snapshot : null);
    const resolvedSpec = resolveLaunchSpec(spec, launchSnapshot?.panes ?? []);
    const action =
      launchTarget.mode === "tab"
        ? () => commands.launchPresetTab(launchTarget.workspaceId, resolvedSpec)
        : () =>
            commands.launchPresetSplit(
              launchTarget.pane.pane_id,
              launchTarget.pane.tab_id,
              launchTarget.direction,
              resolvedSpec,
            );
    void exec(runtime, action, true).then((ok) => ok && setLaunchTarget(null));
  };

  const renderTerminal = !isCompactLayout || showDetail;
  const appStyle = {
    "--sidebar-w": `${sidebarWidth}px`,
    "--notes-w": `${notesPanelWidth}px`,
    "--notes-list-w": `${notesListPaneWidth}px`,
    "--content-inset-top": `${contentInsetTopPx}px`,
    "--content-inset-bottom": `${contentInsetBottomPx}px`,
    "--mobile-controls-scale": String(mobileControlsScalePercent / 100),
  } as CSSProperties &
    Record<
      | "--sidebar-w"
      | "--notes-w"
      | "--notes-list-w"
      | "--content-inset-top"
      | "--content-inset-bottom"
      | "--mobile-controls-scale",
      string
    >;

  return (
    <div
      className="app"
      style={appStyle}
      data-sidebar={sidebarOpen ? "open" : "closed"}
      data-notes={notesPanelOpen && notesEnabled ? "open" : "closed"}
      data-resizing-sidebar={resizingSidebar ? "true" : "false"}
      data-resizing-notes={resizingNotesPanel ? "true" : "false"}
      data-resizing-notes-list={resizingNotesListPane ? "true" : "false"}
      data-compact={isCompactLayout ? "true" : "false"}
      data-touch={isTouchInput ? "true" : "false"}
      data-detail={isCompactLayout && showDetail ? "true" : "false"}
    >
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {spaceReorderAnnouncement}
      </span>
      {bridge.enabledRuntimes.map((runtime) => (
        <BridgeConnectionController
          key={runtime.id}
          runtime={runtime}
          followSharedSelection={navigationIsShared}
          connectionRefs={connectionRefs}
          setConnectionStates={setConnectionStates}
          onPaneSelection={applySharedPaneSelection}
          onAgentActivityChanged={refreshAgentActivityForBridge}
          onAgentPinsChanged={refreshAgentPinsForBridge}
          onNotesChanged={refreshNotesForBridge}
        />
      ))}
      <aside
        className="sidebar"
        aria-label="Switcher"
        data-space-reorder={spaceReorderMode ? "true" : undefined}
        onClickCapture={(event) => {
          if (
            spaceReorderMode &&
            event.target instanceof Element &&
            !event.target.closest(".space-row-shell[data-reorder-source='true']")
          ) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        onContextMenuCapture={(event) => {
          if (spaceReorderMode) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        onKeyDownCapture={(event) => {
          if (!spaceReorderMode || event.key !== "Tab") {
            return;
          }
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>(
              ".space-row-shell[data-reorder-source='true'] > .space-row:not(:disabled), " +
                ".space-reorder-controls button:not(:disabled)",
            ),
          );
          if (controls.length === 0) {
            return;
          }
          event.preventDefault();
          const currentIndex = controls.indexOf(document.activeElement as HTMLButtonElement);
          const nextIndex = event.shiftKey
            ? currentIndex <= 0
              ? controls.length - 1
              : currentIndex - 1
            : currentIndex < 0 || currentIndex === controls.length - 1
              ? 0
              : currentIndex + 1;
          controls[nextIndex]?.focus();
        }}
      >
        <Switcher
          bridgeViews={bridgeViews}
          selectedBridgeId={selectedRuntime?.id ?? null}
          hostScope={hostScope}
          snapshot={snapshot}
          loadState={loadState}
          bridgeCanConnect={selectedRuntime?.canConnect ?? false}
          bridgeError={selectedRuntime?.capabilityError ?? null}
          bridgeLabel={selectedRuntime?.label ?? "No bridge"}
          bridgeMode={selectedRuntime?.mode ?? "configured"}
          capabilityState={selectedRuntime?.capabilityState ?? "idle"}
          scope={scope}
          sidebarView={sidebarView}
          notesEnabled={notesEnabled}
          notesStates={notesStates}
          visibleNotes={visibleNotes}
          selectedNote={selectedScopedNote}
          agentActivityTransitions={agentActivityTransitions}
          pinnedAgentKeys={pinnedAgentKeys}
          agentPinnedOnly={agentPinnedOnly}
          agentActiveOnly={agentActiveOnly}
          agentFeaturesInTabs={agentFeaturesInTabs}
          agentSort={agentSort}
          agentGroup={agentGroup}
          combineMatchingWorkspaceNames={combineMatchingWorkspaceNames}
          collapsedSidebarGroupKeys={collapsedSidebarGroupKeys}
          spaceGroup={spaceGroup}
          spaceReorderMode={spaceReorderMode}
          spaceReorderBusy={busy}
          multiHostSpaceSelection={multiHostSpaceSelection}
          activeSpace={activeSpace}
          activeWorkspacesByBridgeId={activeWorkspacesByBridgeId}
          selectedPane={selectedPane}
          onHostScope={setHostScope}
          onScope={setScope}
          onSidebarView={setSidebarView}
          onSelectNote={selectNote}
          onCreateNote={() => void createDetachedBridgeNote()}
          onAgentPinnedOnly={setAgentPinnedOnly}
          onAgentActiveOnly={setAgentActiveOnly}
          onAgentSort={setAgentSort}
          onAgentGroup={setAgentGroup}
          onToggleCollapsedGroup={toggleCollapsedSidebarGroup}
          onSetCollapsedGroups={setVisibleSidebarGroupsCollapsed}
          onSpaceGroup={setSpaceGroup}
          onCancelSpaceReorder={cancelSpaceReorder}
          onAnnounceSpaceReorder={announceSpaceReorder}
          onReorderSpace={(bridgeId, workspaceId, beforeWorkspaceId, keepMode) =>
            reorderSpace(bridgeId, workspaceId, beforeWorkspaceId, keepMode)
          }
          onSelectBridge={setSelectedBridgeId}
          onSelectSpace={selectSpace}
          onSelectTab={selectTab}
          onSelectPane={openPane}
          onRefresh={refreshNow}
          onRefreshBridge={(bridgeId) => {
            bridge.retryBridgeProbe(bridgeId);
            const runtime = bridge.getRuntime(bridgeId);
            if (runtime?.canConnect) {
              void refreshBridgeSnapshot(runtime, true);
            }
          }}
          onBackendSettings={() => setBackendSettingsOpen(true)}
          theme={theme}
          onToggleTheme={() => setTheme((current) => nextTheme(current))}
          onCreateSpace={() =>
            selectedRuntime && selectedCommands
              ? void exec(selectedRuntime, () => selectedCommands.createWorkspace(), true)
              : setError("Bridge is not ready")
          }
          onCreateTab={(bridgeId, workspaceId) =>
            setLaunchTarget({ mode: "tab", workspaceId, bridgeId })
          }
          onScopedMenu={(kind, bridgeId, id, label, x, y, clearable, pinLabel) =>
            setMenu({ kind, bridgeId, id, label, x, y, clearable, pinLabel })
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
          onSelectTab={(tabId) => selectedRuntime && selectTab(selectedRuntime.id, tabId)}
          onCreateTab={(workspaceId) =>
            selectedRuntime &&
            setLaunchTarget({ mode: "tab", workspaceId, bridgeId: selectedRuntime.id })
          }
          onMenu={(kind, id, label, x, y, clearable) =>
            selectedRuntime &&
            setMenu({ kind, bridgeId: selectedRuntime.id, id, label, x, y, clearable })
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
          <div
            className="stage-id"
            role="button"
            tabIndex={0}
            aria-haspopup="menu"
            aria-expanded={
              menu?.kind === "pane" &&
              menu.bridgeId === selectedRuntime?.id &&
              menu.id === selectedPane?.pane_id
                ? "true"
                : "false"
            }
            aria-label="Selected pane actions"
            {...selectedPaneMenuPress}
          >
            <span className="stage-title">{selectedPane ? paneTitle(selectedPane) : "herdr-web"}</span>
            <span className="stage-sub mono">
              {stageBreadcrumb(snapshot, selectedPane, loadState, selectedRuntime?.canConnect ?? false)}
            </span>
          </div>
          <button
            className="icon-btn"
            type="button"
            aria-label="Search panes"
            title="Search panes across all bridges"
            onClick={() => setShowPaneSearch(true)}
          >
            <Search size={18} />
          </button>
          <button
            className="icon-btn"
            type="button"
            aria-label={talkBack.enabled ? "Mute talk back" : "Enable talk back"}
            title={
              talkBack.state === "unprimed"
                ? "Talk back armed — tap once more anywhere to unlock speech"
                : talkBack.state === "unsupported"
                  ? "Talk back unavailable: this browser has no speech synthesis"
                  : talkBack.enabled
                    ? "Mute agent speech (talk back)"
                    : "Speak agent responses aloud (talk back)"
            }
            onClick={talkBack.toggle}
          >
            {talkBack.enabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
          {splitSupported && selectedPane && !isCompactLayout ? (
            <>
              <button
                className="icon-btn"
                type="button"
                aria-label="Split right"
                title="Split right"
                disabled={busy}
                onClick={(event) => {
                  focusOverlayTrigger(event.currentTarget);
                  if (selectedRuntime) {
                    setLaunchTarget({
                      mode: "split",
                      pane: selectedPane,
                      direction: "right",
                      bridgeId: selectedRuntime.id,
                    });
                  }
                }}
              >
                <SplitSquareHorizontal size={18} />
              </button>
              <button
                className="icon-btn"
                type="button"
                aria-label="Split down"
                title="Split down"
                disabled={busy}
                onClick={(event) => {
                  focusOverlayTrigger(event.currentTarget);
                  if (selectedRuntime) {
                    setLaunchTarget({
                      mode: "split",
                      pane: selectedPane,
                      direction: "down",
                      bridgeId: selectedRuntime.id,
                    });
                  }
                }}
              >
                <SplitSquareVertical size={18} />
              </button>
            </>
          ) : null}
          {selectedPane && notesEnabled ? (
            <button
              className="icon-btn notes-button"
              type="button"
              aria-label="Notes"
              title="Notes"
              data-active={notesPanelOpen ? "true" : "false"}
              data-has-notes={selectedPaneNotes.length > 0 ? "true" : "false"}
              onClick={openNotesPanel}
            >
              <StickyNote size={18} />
            </button>
          ) : null}
          {selectedPane && selectedRuntime && selectedPanePinsSupported ? (
            <button
              className="icon-btn stage-pin-button"
              type="button"
              aria-label={selectedPanePinTitle}
              title={selectedPanePinTitle}
              aria-pressed={selectedPanePinned}
              data-on={selectedPanePinned}
              onClick={() =>
                void toggleAgentPin(selectedRuntime.id, selectedPane.pane_id, selectedPanePinned)
              }
            >
              <Pin size={16} />
            </button>
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
              if (selectedRuntime) {
                openPane(selectedRuntime.id, pane);
              }
              if (isTouchInput) {
                requestTerminalFocus();
              }
            }}
            refitToken={refitToken}
            focusToken={terminalFocusToken}
            touchInput={isTouchInput}
            theme={theme}
            terminalFontSizePx={terminalFontSizePx}
            terminalScreenReaderText={terminalScreenReaderText}
            mobileControlsScalePercent={mobileControlsScalePercent}
            mobileCompactControls={mobileCompactControls}
            onMobileCompactControlsChange={setMobileCompactControls}
            mobileTapTarget={mobileTerminalTapTarget}
            mobileLongPressBehavior={mobileLongPressBehavior}
            mobileTouchSelectionEndpointTimeoutMs={mobileTouchSelectionEndpointTimeoutMs}
            mobileCommandExpandingInput={mobileCommandExpandingInput}
            mobileCommandEnterNewline={mobileCommandEnterNewline}
            terminalInputTransport={terminalInputTransport}
            terminalInputBatchDelayMs={terminalInputBatchDelayMs}
            terminalOutputCoalesceMs={terminalOutputCoalesceMs}
            connectionKey={selectedRuntime?.connectionKey ?? "disconnected"}
            resumeToken={selectedRuntime?.resumeToken ?? 0}
            httpUrl={selectedHttpUrl}
            wsUrl={selectedWsUrl}
            onNextAgentPane={() => focusAdjacentAgentPane(1)}
            onPrevAgentPane={() => focusAdjacentAgentPane(-1)}
            pinned={selectedPanePinned}
            onPaneCycle={cycleAgentPane}
            onPaneCycleModeToggle={togglePaneCycleMode}
            paneCycleMode={paneCycleMode}
          />
        ) : renderTerminal ? (
          <TerminalView
            pane={selectedPane}
            connectionKey={selectedRuntime?.connectionKey ?? "disconnected"}
            resumeToken={selectedRuntime?.resumeToken ?? 0}
            httpUrl={selectedHttpUrl}
            wsUrl={selectedWsUrl}
            autoFocus={!isTouchInput}
            scrollSensitivity={isTouchInput ? 2 : 0.4}
            // The parlay-backed command composer is the single input experience at every
            // viewport width and pointer type — no longer gated on touch input.
            mobileControls={true}
            cursorBlink={!isTouchInput}
            theme={theme}
            terminalFontSizePx={terminalFontSizePx}
            terminalScreenReaderText={terminalScreenReaderText}
            mobileControlsScalePercent={mobileControlsScalePercent}
            mobileCompactControls={mobileCompactControls}
            onMobileCompactControlsChange={setMobileCompactControls}
            mobileTapTarget={mobileTerminalTapTarget}
            mobileLongPressBehavior={mobileLongPressBehavior}
            mobileTouchSelectionEndpointTimeoutMs={mobileTouchSelectionEndpointTimeoutMs}
            mobileCommandExpandingInput={mobileCommandExpandingInput}
            mobileCommandEnterNewline={mobileCommandEnterNewline}
            terminalInputTransport={terminalInputTransport}
            terminalInputBatchDelayMs={terminalInputBatchDelayMs}
            terminalOutputCoalesceMs={terminalOutputCoalesceMs}
            refitToken={refitToken}
            focusToken={terminalFocusToken}
            onNextAgentPane={() => focusAdjacentAgentPane(1)}
            onPrevAgentPane={() => focusAdjacentAgentPane(-1)}
            pinned={selectedPanePinned}
            onPaneCycle={cycleAgentPane}
            onPaneCycleModeToggle={togglePaneCycleMode}
            paneCycleMode={paneCycleMode}
            onAccessibleTextChange={talkBack.handleAccessibleText}
            accessibilityLabel={
              selectedPane ? `Selected pane terminal: ${paneTitle(selectedPane)}` : "Terminal"
            }
            selected={Boolean(selectedPane)}
          />
        ) : (
          <div className="terminal-stage" aria-hidden="true" />
        )}
      </section>

      {notesPanelOpen && notesEnabled ? (
        <NotesSurface
          compact={isCompactLayout}
          mobileScreen={mobileNotesScreen}
          selectedEntry={selectedScopedNote}
          selectedBridgeId={selectedRuntime?.id ?? null}
          titleFocusRequest={noteTitleFocusRequest}
          onTitleFocusRequestHandled={clearNoteTitleFocusRequest}
          selectedPane={selectedPane}
          selectedPaneNotes={selectedRuntime ? selectedPaneNotes.map((note) => ({
            bridgeId: selectedRuntime.id,
            connectionKey: selectedRuntime.connectionKey,
            storeId: selectedNotesState?.response?.store_id ?? "unknown-store",
            sessionKey: note.session_key,
            bridgeSessionKey: selectedNotesState?.response?.session_key ?? note.session_key,
            bridgeIndex: Math.max(
              0,
              bridgeViews.findIndex((view) => view.runtime.id === selectedRuntime.id),
            ),
            bridgeLabel: selectedRuntime.label,
            bridgeColor: selectedRuntime.color,
            note,
            snapshot,
            workspace: snapshot?.workspaces.find(
              (workspace) => workspace.workspace_id === note.attachment?.workspace_id,
            ),
            pane: note.resolved_pane,
          })) : []}
          visibleNotes={visibleNotes}
          notesLoadState={selectedNotesState?.loadState ?? "ready"}
          notesError={selectedNotesState?.error ?? null}
          includeArchived={notesIncludeArchived}
          includeDeleted={notesIncludeDeleted}
          currentBridgeSupportsNotes={Boolean(
            selectedRuntime && supportsNotes(selectedRuntime.capabilities),
          )}
          canAttachToCurrentPane={Boolean(
            selectedRuntime &&
              selectedPane &&
              selectedScopedNote &&
              selectedScopedNote.bridgeId === selectedRuntime.id,
          )}
          onClose={() => setNotesPanelOpen(false)}
          onShowNotesList={() => setMobileNotesScreen("list")}
          onSelectNote={selectNote}
          onCreatePaneNote={() => void createNoteForCurrentPane()}
          onCreateDetachedNote={() => void createDetachedBridgeNote()}
          onIncludeArchived={setNotesIncludeArchived}
          onIncludeDeleted={setNotesIncludeDeleted}
          onSaveNote={saveScopedNote}
          onAttachToCurrentPane={(entry) => void attachScopedNoteToCurrentPane(entry)}
          onDetach={(entry) => void detachScopedNote(entry)}
          onArchive={(entry) => void archiveScopedNote(entry)}
          onRestore={(entry) => void restoreScopedNote(entry)}
          onDelete={setNoteDeleteTarget}
          onViewPane={viewScopedNotePane}
          width={notesPanelWidth}
          listWidth={notesListPaneWidth}
          listCollapsed={notesListPaneCollapsed}
          onListCollapsed={setNotesListPaneCollapsed}
          onResizeStart={(clientX) => {
            if (isCompactLayout) {
              return;
            }
            setNotesPanelWidth(
              clampNotesPanelWidth(window.innerWidth - clientX, sidebarWidth, sidebarOpen),
            );
            setResizingNotesPanel(true);
          }}
          onResizeKeyDown={(event) => {
            if (isCompactLayout) {
              return;
            }
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              const step = event.shiftKey ? 32 : 12;
              setNotesPanelWidth((width) =>
                clampNotesPanelWidth(
                  width + (event.key === "ArrowLeft" ? step : -step),
                  sidebarWidth,
                  sidebarOpen,
                ),
              );
            } else if (event.key === "Home") {
              event.preventDefault();
              setNotesPanelWidth(MIN_NOTES_PANEL_WIDTH);
            } else if (event.key === "End") {
              event.preventDefault();
              setNotesPanelWidth(
                clampNotesPanelWidth(MAX_NOTES_PANEL_WIDTH, sidebarWidth, sidebarOpen),
              );
            }
          }}
          onListResizeStart={(surfaceLeft, clientX) => {
            if (isCompactLayout || notesListPaneCollapsed) {
              return;
            }
            notesListResizeLeftRef.current = surfaceLeft;
            setNotesListPaneWidth(clampNotesListPaneWidth(clientX - surfaceLeft, notesPanelWidth));
            setResizingNotesListPane(true);
          }}
          onListResizeKeyDown={(event) => {
            if (isCompactLayout || notesListPaneCollapsed) {
              return;
            }
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              const step = event.shiftKey ? 32 : 12;
              setNotesListPaneWidth((width) =>
                clampNotesListPaneWidth(
                  width + (event.key === "ArrowRight" ? step : -step),
                  notesPanelWidth,
                ),
              );
            } else if (event.key === "Home") {
              event.preventDefault();
              setNotesListPaneWidth(MIN_NOTES_LIST_PANE_WIDTH);
            } else if (event.key === "End") {
              event.preventDefault();
              setNotesListPaneWidth(
                clampNotesListPaneWidth(MAX_NOTES_LIST_PANE_WIDTH, notesPanelWidth),
              );
            }
          }}
        />
      ) : null}

      {menu && activeMenuItems.length > 0 ? (
        <ActionMenu
          x={menu.x}
          y={menu.y}
          title={menu.label}
          items={activeMenuItems}
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

      {quickPaneNoteTarget ? (
        <QuickPaneNoteDialog
          targetLabel={quickPaneNoteTarget.label}
          busy={quickPaneNoteCreating}
          onCancel={() => {
            if (!quickPaneNoteCreating) {
              setQuickPaneNoteTarget(null);
            }
          }}
          onSubmit={(title, body) => void createQuickPaneNote(title, body)}
        />
      ) : null}

      {noteDeleteTarget ? (
        <ConfirmDialog
          title="Delete note"
          message={`Move "${noteDeleteTarget.note.title || "Untitled note"}" to deleted notes? You can restore it later from the Deleted filter.`}
          confirmLabel="Delete"
          busy={deletingNote}
          onCancel={() => {
            if (!deletingNote) {
              setNoteDeleteTarget(null);
            }
          }}
          onConfirm={() => void confirmDeleteNote()}
        />
      ) : null}

      {showPaneSearch ? (
        <PaneSearchDialog
          entries={paneSearchEntries}
          onCancel={() => setShowPaneSearch(false)}
          onSelect={handlePaneSearchSelect}
        />
      ) : null}

      {launchTarget ? (
        <LaunchDialog
          target={launchTarget}
          busy={busy}
          options={launchOptions}
          emptyMessage={launchEmptyMessage}
          onCancel={() => setLaunchTarget(null)}
          onSubmit={submitLaunch}
        />
      ) : null}

      {backendSettingsOpen ? (
        <BackendSettingsDialog
          showMobileTerminalSettings={isTouchInput}
          notesEnabled={notesEnabled}
          onNotesEnabled={setNotesEnabled}
          navigationSyncMode={navigationSyncMode}
          onNavigationSyncMode={changeNavigationSyncMode}
          agentFeaturesInTabs={agentFeaturesInTabs}
          onAgentFeaturesInTabs={setAgentFeaturesInTabs}
          combineMatchingWorkspaceNames={combineMatchingWorkspaceNames}
          onCombineMatchingWorkspaceNames={setCombineMatchingWorkspaceNames}
          multiHostSpaceSelection={multiHostSpaceSelection}
          onMultiHostSpaceSelection={setMultiHostSpaceSelection}
          terminalFontSizePx={terminalFontSizePx}
          onTerminalFontSizePx={setTerminalFontSizePx}
          terminalScreenReaderText={terminalScreenReaderText}
          onTerminalScreenReaderText={setTerminalScreenReaderText}
          terminalInputTransport={terminalInputTransport}
          onTerminalInputTransport={setTerminalInputTransport}
          terminalInputBatchDelayMs={terminalInputBatchDelayMs}
          onTerminalInputBatchDelayMs={setTerminalInputBatchDelayMs}
          terminalOutputCoalesceMs={terminalOutputCoalesceMs}
          onTerminalOutputCoalesceMs={setTerminalOutputCoalesceMs}
          contentInsetTopPx={contentInsetTopPx}
          onContentInsetTopPx={setContentInsetTopPx}
          contentInsetBottomPx={contentInsetBottomPx}
          onContentInsetBottomPx={setContentInsetBottomPx}
          mobileControlsScalePercent={mobileControlsScalePercent}
          onMobileControlsScalePercent={setMobileControlsScalePercent}
          mobileCompactControls={mobileCompactControls}
          onMobileCompactControlsChange={setMobileCompactControls}
          mobileTerminalTapTarget={mobileTerminalTapTarget}
          onMobileTerminalTapTarget={setMobileTerminalTapTarget}
          mobileLongPressBehavior={mobileLongPressBehavior}
          onMobileLongPressBehavior={setMobileLongPressBehavior}
          mobileTouchSelectionEndpointTimeoutMs={mobileTouchSelectionEndpointTimeoutMs}
          onMobileTouchSelectionEndpointTimeoutMs={
            setMobileTouchSelectionEndpointTimeoutMs
          }
          mobileCommandExpandingInput={mobileCommandExpandingInput}
          onMobileCommandExpandingInput={setMobileCommandExpandingInput}
          mobileCommandEnterNewline={mobileCommandEnterNewline}
          onMobileCommandEnterNewline={setMobileCommandEnterNewline}
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

const SNAPSHOT_REFRESH_INTERVAL_MS = 10000;
const SHARED_SELECTION_SETTLE_TIMEOUT_MS = 2000;
const NOTES_REFRESH_INTERVAL_MS = 15000;
const MAX_PENDING_CREATED_PANE_NOTES = 32;
const NOTE_DRAFT_STORAGE_PREFIX = "herdr-web:note-draft:v1:";
const NOTE_EDITOR_MODE_STORAGE_KEY = "herdr-web:note-editor-mode:v1";

export function resolveInitialSelectedBridgeId(
  currentBridgeId: BridgeId | null,
  enabledBridgeIds: readonly BridgeId[],
  lastSelectedBridgeId: BridgeId | null,
) {
  if (currentBridgeId && enabledBridgeIds.includes(currentBridgeId)) {
    return currentBridgeId;
  }
  if (lastSelectedBridgeId && enabledBridgeIds.includes(lastSelectedBridgeId)) {
    return lastSelectedBridgeId;
  }
  return enabledBridgeIds[0] ?? null;
}

export function shouldCollapseHostScope(
  hostScope: HostScope,
  enabledBridgeCount: number,
  storeLoaded: boolean,
) {
  return storeLoaded && hostScope === "all" && enabledBridgeCount <= 1;
}

export function BridgeConnectionController({
  runtime,
  followSharedSelection,
  connectionRefs,
  setConnectionStates,
  onPaneSelection,
  onAgentActivityChanged,
  onAgentPinsChanged,
  onNotesChanged,
}: {
  runtime: BridgeRuntime;
  followSharedSelection: boolean;
  connectionRefs: MutableRefObject<Record<string, BridgeConnectionRef>>;
  setConnectionStates: Dispatch<SetStateAction<Record<string, BridgeConnectionState>>>;
  onPaneSelection: (bridgeId: BridgeId, paneId: string, workspaceId?: string) => void;
  onAgentActivityChanged: (bridgeId: BridgeId) => void;
  onAgentPinsChanged: (bridgeId: BridgeId) => void;
  onNotesChanged: (bridgeId: BridgeId) => void;
}) {
  const httpUrlRef = useRef(runtime.httpUrl);
  const wsUrlRef = useRef(runtime.wsUrl);
  const onAgentActivityChangedRef = useRef(onAgentActivityChanged);
  const onAgentPinsChangedRef = useRef(onAgentPinsChanged);
  const onNotesChangedRef = useRef(onNotesChanged);
  const followSharedSelectionRef = useRef(followSharedSelection);
  const refreshOffsetRef = useRef(stableBridgeRefreshOffsetMs(runtime.id));

  useEffect(() => {
    httpUrlRef.current = runtime.httpUrl;
    wsUrlRef.current = runtime.wsUrl;
  }, [runtime.httpUrl, runtime.wsUrl]);

  useEffect(() => {
    followSharedSelectionRef.current = followSharedSelection;
    onAgentActivityChangedRef.current = onAgentActivityChanged;
    onAgentPinsChangedRef.current = onAgentPinsChanged;
    onNotesChangedRef.current = onNotesChanged;
  }, [
    followSharedSelection,
    onAgentActivityChanged,
    onAgentPinsChanged,
    onNotesChanged,
  ]);

  useEffect(() => {
    let disposed = false;
    let interval: number | null = null;
    let intervalStartTimer: number | null = null;
    const ref = ensureBridgeConnectionRef(connectionRefs, runtime);

    if (!runtime.canConnect) {
      ref.snapshot = null;
      setConnectionStates((current) => ({
        ...current,
        [runtime.id]: {
          connectionKey: runtime.connectionKey,
          snapshot: null,
          loadState: "ready",
        },
      }));
      return () => {
        disposed = true;
      };
    }

    setConnectionStates((current) => {
      const existing = current[runtime.id];
      if (existing?.connectionKey === runtime.connectionKey && existing.loadState !== "error") {
        return current;
      }
      return {
        ...current,
        [runtime.id]: {
          connectionKey: runtime.connectionKey,
          snapshot: existing?.connectionKey === runtime.connectionKey ? existing.snapshot : null,
          loadState: "loading",
        },
      };
    });

    const requestConnectionKey = runtime.connectionKey;
    const isCurrentConnection = () =>
      !disposed &&
      isConnectionResultCurrent(
        connectionRefs.current[runtime.id]?.connectionKey ?? "",
        requestConnectionKey,
      );
    const refreshController = createSnapshotRefreshController({
      fetchSnapshot: () => fetchSnapshot(httpUrlRef.current),
      getGeneration: () => connectionRefs.current[runtime.id]?.activityGeneration ?? 0,
      getBarrierGeneration: () =>
        connectionRefs.current[runtime.id]?.resyncBarrierGeneration ?? 0,
      isCurrent: isCurrentConnection,
      onError: () =>
        setConnectionStates((current) => ({
          ...current,
          [runtime.id]: {
            connectionKey: requestConnectionKey,
            snapshot:
              current[runtime.id]?.connectionKey === requestConnectionKey
                ? current[runtime.id]?.snapshot ?? null
                : null,
            loadState: "error",
          },
        })),
      applySnapshot: (next, refreshGeneration) => {
        const currentRef = connectionRefs.current[runtime.id];
        if (!currentRef || currentRef.connectionKey !== requestConnectionKey) {
          return;
        }
        const patched = applySnapshotOverlays(next, currentRef, refreshGeneration);
        currentRef.snapshot = patched;
        // Snapshot reconciliation touches the whole (un-memoized) pane/sidebar
        // tree. Mark it a low-priority transition so it stays interruptible and
        // never blocks keystroke handling on the main thread.
        startTransition(() => {
          setConnectionStates((current) => ({
            ...current,
            [runtime.id]: {
              connectionKey: requestConnectionKey,
              snapshot: patched,
              loadState: "ready",
            },
          }));
        });
      },
    });
    const refresh = () => refreshController.request();
    const requestActivityResync = () => {
      const currentRef = connectionRefs.current[runtime.id];
      if (!currentRef) {
        return;
      }
      currentRef.activityGeneration += 1;
      currentRef.resyncBarrierGeneration = currentRef.activityGeneration;
      refresh();
    };

    refresh();
    const refreshOffset = refreshOffsetRef.current;
    intervalStartTimer = window.setTimeout(() => {
      refresh();
      interval = window.setInterval(refresh, SNAPSHOT_REFRESH_INTERVAL_MS);
    }, SNAPSHOT_REFRESH_INTERVAL_MS + refreshOffset);

    // Proxied remote runtimes only get the hub's terminal proxy
    // (`/ws/remote/<id>/terminal`); the event sockets below are not proxied and
    // would 404-reconnect forever. Skip them and rely on interval polling +
    // the immediate refresh above for remote snapshot freshness.
    const events = runtime.proxied
      ? null
      : openEventsSocket(wsUrlRef.current, "/ws/events", refresh);
    const activity = runtime.proxied
      ? null
      : openEventsSocket(
      wsUrlRef.current,
      "/ws/activity",
      (event) => {
        if (!isCurrentConnection()) {
          return;
        }
        const currentRef = connectionRefs.current[runtime.id];
        if (!currentRef) {
          return;
        }
        const parsed = parseActivityEventData(event.data);
        if (parsed.status === "ignored") {
          return;
        }
        if (parsed.status === "invalid_known") {
          requestActivityResync();
          return;
        }
        const result = applyActivityMessage(currentRef.snapshot, parsed.message);
        if (result.status === "applied") {
          currentRef.activityGeneration += 1;
          currentRef.activityLog = [
            ...currentRef.activityLog,
            { generation: currentRef.activityGeneration, message: parsed.message },
          ].slice(-100);
          currentRef.snapshot = result.snapshot;
          // Agent-status activity bursts (idle→running→idle) are the most
          // frequent snapshot updates while an agent is working. Defer their
          // reconciliation so a chatty agent doesn't hitch typing.
          startTransition(() => {
            setConnectionStates((current) => ({
              ...current,
              [runtime.id]: {
                connectionKey: requestConnectionKey,
                snapshot: result.snapshot,
                loadState: "ready",
              },
            }));
          });
        } else if (result.status === "resync") {
          requestActivityResync();
        }
      },
      { onOpen: refresh },
    );
    const uiEvents = runtime.proxied
      ? null
      : openEventsSocket(
      wsUrlRef.current,
      "/ws/ui-events",
      (event) => {
        if (!isCurrentConnection()) {
          return;
        }
        const paneId = selectionPaneId(event);
        if (paneId) {
          const currentRef = connectionRefs.current[runtime.id];
          if (!currentRef) {
            return;
          }
          currentRef.activityGeneration += 1;
          currentRef.resyncBarrierGeneration = currentRef.activityGeneration;
          currentRef.sharedSelectionOverride = {
            paneId,
            expiresAtMs: Date.now() + SHARED_SELECTION_SETTLE_TIMEOUT_MS,
          };
          const currentSnapshot = currentRef.snapshot;
          const patched = currentSnapshot
            ? { ...currentSnapshot, selected_pane_id: paneId }
            : null;
          if (patched) {
            currentRef.snapshot = patched;
          }
          const pane = currentSnapshot?.panes.find(
            (item) => item.pane_id === paneId,
          );
          const shouldFollowSelection = followSharedSelectionRef.current;
          startTransition(() => {
            if (patched) {
              setConnectionStates((current) => ({
                ...current,
                [runtime.id]: {
                  connectionKey: requestConnectionKey,
                  snapshot: patched,
                  loadState: "ready",
                },
              }));
            }
            if (shouldFollowSelection) {
              onPaneSelection(runtime.id, paneId, pane?.workspace_id);
            }
          });
          refresh();
          return;
        }
        if (isNotesChangedEvent(event)) {
          onNotesChangedRef.current(runtime.id);
          return;
        }
        if (isAgentActivityChangedEvent(event)) {
          onAgentActivityChangedRef.current(runtime.id);
          return;
        }
        if (isAgentPinsChangedEvent(event)) {
          onAgentPinsChangedRef.current(runtime.id);
          return;
        }
        refresh();
      },
      { onOpen: () => onAgentActivityChangedRef.current(runtime.id) },
    );

    return () => {
      disposed = true;
      events?.close();
      activity?.close();
      uiEvents?.close();
      if (intervalStartTimer !== null) {
        window.clearTimeout(intervalStartTimer);
      }
      if (interval !== null) {
        window.clearInterval(interval);
      }
    };
  }, [
    connectionRefs,
    onPaneSelection,
    runtime.canConnect,
    runtime.connectionKey,
    runtime.id,
    runtime.resumeToken,
    setConnectionStates,
  ]);

  return null;
}

export function stableBridgeRefreshOffsetMs(bridgeId: BridgeId) {
  let hash = 0;
  for (let index = 0; index < bridgeId.length; index += 1) {
    hash = (hash * 31 + bridgeId.charCodeAt(index)) >>> 0;
  }
  return hash % SNAPSHOT_REFRESH_INTERVAL_MS;
}

export function applySnapshotOverlays(
  snapshot: Snapshot,
  ref: BridgeConnectionRef,
  refreshGeneration: number,
) {
  const patched = replayActivityMessages(snapshot, ref.activityLog, refreshGeneration);
  const selectionOverride = ref.sharedSelectionOverride;
  if (!selectionOverride) {
    return patched;
  }
  if (
    patched.selected_pane_id === selectionOverride.paneId ||
    Date.now() >= selectionOverride.expiresAtMs
  ) {
    ref.sharedSelectionOverride = null;
    return patched;
  }
  return {
    ...patched,
    selected_pane_id: selectionOverride.paneId,
  };
}

function ensureBridgeConnectionRef(
  connectionRefs: MutableRefObject<Record<string, BridgeConnectionRef>>,
  runtime: BridgeRuntime,
) {
  const existing = connectionRefs.current[runtime.id];
  if (existing?.connectionKey === runtime.connectionKey) {
    return existing;
  }
  const next: BridgeConnectionRef = {
    connectionKey: runtime.connectionKey,
    snapshot: null,
    activityGeneration: 0,
    resyncBarrierGeneration: 0,
    activityLog: [],
    sharedSelectionOverride: null,
  };
  connectionRefs.current[runtime.id] = next;
  return next;
}

export function visibleHostBridgeViews(
  bridgeViews: BridgeConnectionView[],
  selectedBridgeId: BridgeId | null,
  hostScope: HostScope,
) {
  if (hostScope === "all") {
    return bridgeViews;
  }
  const selectedBridgeView = selectedBridgeId
    ? (bridgeViews.find((view) => view.runtime.id === selectedBridgeId) ?? null)
    : null;
  return selectedBridgeView ? [selectedBridgeView] : [];
}

export function activeWorkspaceForBridgeView(
  view: BridgeConnectionView,
  selectedBridgeId: BridgeId | null,
  activeSpace: WorkspaceInfo | null,
  activeWorkspacesByBridgeId: Record<string, string>,
  multiHostSpaceSelection = true,
) {
  const viewSnapshot = view.snapshot;
  if (!viewSnapshot || viewSnapshot.workspaces.length === 0) {
    return null;
  }
  if (!multiHostSpaceSelection && view.runtime.id !== selectedBridgeId) {
    return null;
  }
  const preferredWorkspaceId =
    view.runtime.id === selectedBridgeId
      ? (activeSpace?.workspace_id ?? activeWorkspacesByBridgeId[view.runtime.id])
      : activeWorkspacesByBridgeId[view.runtime.id];
  return (
    (preferredWorkspaceId &&
      viewSnapshot.workspaces.find((workspace) => workspace.workspace_id === preferredWorkspaceId)) ||
    viewSnapshot.workspaces.find((workspace) => workspace.focused) ||
    viewSnapshot.workspaces[0] ||
    null
  );
}

const EMPTY_PANE_NOTES: PaneNote[] = [];
const EMPTY_AGENT_PIN_KEYS = new Set<string>();
const EMPTY_AGENT_ACTIVITY_TRANSITIONS = new Map<string, number>();

export function isAgentPinned(
  pinnedAgentKeys: ReadonlySet<string>,
  bridgeId: BridgeId,
  paneId: string,
) {
  return pinnedAgentKeys.has(agentPinKey(bridgeId, paneId));
}

export function buildAgentPinKeySet(
  bridgeViews: BridgeConnectionView[],
  agentPinsStates: Record<string, BridgeAgentPinsState>,
) {
  const keys = new Set<string>();
  for (const view of bridgeViews) {
    const state = agentPinsStates[view.runtime.id];
    if (!state || state.connectionKey !== view.runtime.connectionKey) {
      continue;
    }
    for (const key of agentPinKeys(view.runtime.id, state.response)) {
      keys.add(key);
    }
  }
  return keys;
}

export function buildAgentActivityTransitionMap(
  bridgeViews: BridgeConnectionView[],
  agentActivityStates: Record<string, BridgeAgentActivityState>,
) {
  const transitions = new Map<string, number>();
  for (const view of bridgeViews) {
    const state = agentActivityStates[view.runtime.id];
    if (!state || state.connectionKey !== view.runtime.connectionKey) {
      continue;
    }
    for (const [key, value] of agentActivityTimestamps(view.runtime.id, state.response)) {
      transitions.set(key, value);
    }
  }
  return transitions;
}

function sortedAgentEntriesWithinGroup(entries: ScopedAgentPane[]) {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const pinned = Number(b.entry.pinned === true) - Number(a.entry.pinned === true);
      if (pinned !== 0) {
        return pinned;
      }
      return a.index - b.index;
    })
    .map(({ entry }) => entry);
}

export function buildVisibleScopedWorkspaces(
  bridgeViews: BridgeConnectionView[],
  selectedBridgeId: BridgeId | null,
  hostScope: HostScope,
  scope: Scope,
  activeSpace: WorkspaceInfo | null,
  activeWorkspacesByBridgeId: Record<string, string>,
  multiHostSpaceSelection = true,
): ScopedWorkspace[] {
  const hostBridgeViews = visibleHostBridgeViews(bridgeViews, selectedBridgeId, hostScope);
  return hostBridgeViews.flatMap((view) => {
    const viewSnapshot = view.snapshot;
    if (!viewSnapshot) {
      return [];
    }
    const bridgeIndex = Math.max(
      0,
      bridgeViews.findIndex((candidate) => candidate.runtime.id === view.runtime.id),
    );
    const workspaces =
      scope === "all"
        ? viewSnapshot.workspaces
        : [
            activeWorkspaceForBridgeView(
              view,
              selectedBridgeId,
              activeSpace,
              activeWorkspacesByBridgeId,
              multiHostSpaceSelection,
            ),
          ].filter((workspace): workspace is WorkspaceInfo => workspace !== null);
    return workspaces.map((workspace) => ({
      bridgeId: view.runtime.id,
      bridgeIndex,
      bridgeLabel: view.runtime.label,
      bridgeColor: view.runtime.color,
      snapshot: viewSnapshot,
      workspace,
    }));
  });
}

export function buildVisibleAgentPaneEntries(
  scopedWorkspaces: ScopedWorkspace[],
  bridgeViews: BridgeConnectionView[],
  hostScope: HostScope,
  agentGroup: AgentGroup,
  agentSort: AgentSort,
  pinnedAgentKeys: ReadonlySet<string> = EMPTY_AGENT_PIN_KEYS,
  pinnedOnly = false,
  agentActivityTransitions: ReadonlyMap<string, number> = EMPTY_AGENT_ACTIVITY_TRANSITIONS,
  activeOnly = false,
  combineMatchingWorkspaceNames = false,
) {
  const buildRows = (sort: AgentSort) =>
    scopedWorkspaces.flatMap((entry) => {
      const sorted = sortAgentPanes(
        entry.snapshot.panes.filter(
          (pane) => pane.workspace_id === entry.workspace.workspace_id && isAgentPane(pane),
        ),
        sort,
        entry.snapshot,
      );
      return sorted.map((pane) => {
        const tab = entry.snapshot.tabs.find((item) => item.tab_id === pane.tab_id);
        return {
          bridgeId: entry.bridgeId,
          bridgeIndex: entry.bridgeIndex,
          bridgeLabel: entry.bridgeLabel,
          bridgeColor: entry.bridgeColor,
          pane,
          snapshot: entry.snapshot,
          workspace: entry.workspace,
          tabNumber: tab?.number,
          tabLabel: tab ? displayTabLabel(tab, entry.snapshot.panes) : undefined,
          pinned: isAgentPinned(pinnedAgentKeys, entry.bridgeId, pane.pane_id),
          lastStatusTransitionAt: agentActivityTransitions.get(
            agentActivityKey(entry.bridgeId, pane.pane_id, pane.terminal_id),
          ),
        };
      });
    });

  if (agentSort === "lastStatusChange" && agentGroup !== "none") {
    const agentPanes = filterAgentEntries(buildRows("workspace"), pinnedOnly, activeOnly);
    const groups = buildScopedAgentGroups(
      agentPanes,
      agentGroup,
      combineMatchingWorkspaceNames,
    ).map((group) => ({
      ...group,
      panes: sortedAgentEntriesWithinGroup(sortScopedAgentPanes(group.panes, agentSort)),
    }));
    if (agentGroup === "hostWorkspace" && hostScope === "all") {
      return bridgeViews.flatMap((view) =>
        groups.filter((group) => group.bridgeId === view.runtime.id).flatMap((group) => group.panes),
      );
    }
    return groups.flatMap((group) => group.panes);
  }

  const sortedAgentPanes = sortScopedAgentPanes(buildRows(agentSort), agentSort);
  const filteredAgentPanes = filterAgentEntries(sortedAgentPanes, pinnedOnly, activeOnly);
  const agentPanes = pinnedOnly
    ? filteredAgentPanes
    : sortedAgentEntriesWithinGroup(filteredAgentPanes);
  if (agentGroup === "none") {
    return agentPanes;
  }

  const groups = buildScopedAgentGroups(
    agentPanes,
    agentGroup,
    combineMatchingWorkspaceNames,
  ).map((group) => ({
    ...group,
    panes: sortedAgentEntriesWithinGroup(group.panes),
  }));
  if (agentGroup === "hostWorkspace" && hostScope === "all") {
    return bridgeViews.flatMap((view) =>
      groups.filter((group) => group.bridgeId === view.runtime.id).flatMap((group) => group.panes),
    );
  }
  return groups.flatMap((group) => group.panes);
}

type CollapsibleSidebarView = "agents" | "tabs" | "spaces";
type CollapsibleGroupLevel = "host" | "workspace";

export function sidebarGroupCollapseKey(
  view: CollapsibleSidebarView,
  grouping: AgentGroup | SpaceGroup,
  level: CollapsibleGroupLevel,
  identity: string,
) {
  return [view, grouping, level, identity].map(encodeURIComponent).join(":");
}

export function updateCollapsedSidebarGroups(
  current: readonly string[],
  keys: readonly string[],
  collapsed: boolean,
) {
  const targetKeys = new Set(keys);
  if (!collapsed) {
    return current.filter((key) => !targetKeys.has(key));
  }
  const unrelatedKeys = current.filter((key) => !targetKeys.has(key));
  const limit = Math.max(MAX_COLLAPSED_SIDEBAR_GROUPS, targetKeys.size);
  return [...unrelatedKeys, ...targetKeys].slice(-limit);
}

export function areAllVisibleSidebarGroupsCollapsed(
  keys: readonly string[],
  grouping: AgentGroup,
  hostScope: HostScope,
  collapsedKeys: ReadonlySet<string>,
) {
  const stateKeys =
    grouping === "hostWorkspace" && hostScope === "all"
      ? keys.filter((key) => key.split(":")[2] === "host")
      : keys;
  return stateKeys.length > 0 && stateKeys.every((key) => collapsedKeys.has(key));
}

function workspaceGroupIdentity(
  bridgeId: BridgeId,
  workspaceId: string,
  workspaceLabel: string,
  combineMatchingWorkspaceNames: boolean,
) {
  return combineMatchingWorkspaceNames
    ? `workspace-name:${workspaceLabel.trim() || "workspace"}`
    : `${bridgeId}:${workspaceId}`;
}

function entryCollapseKeys(
  view: "agents" | "tabs",
  bridgeId: BridgeId,
  workspaceId: string,
  workspaceLabel: string,
  agentGroup: AgentGroup,
  hostScope: HostScope,
  combineMatchingWorkspaceNames: boolean,
) {
  if (agentGroup === "none") {
    return [];
  }
  if (agentGroup === "host") {
    return [sidebarGroupCollapseKey(view, agentGroup, "host", bridgeId)];
  }
  const workspaceKey = sidebarGroupCollapseKey(
    view,
    agentGroup,
    "workspace",
    workspaceGroupIdentity(
      bridgeId,
      workspaceId,
      workspaceLabel,
      agentGroup === "workspace" && combineMatchingWorkspaceNames,
    ),
  );
  return agentGroup === "hostWorkspace" && hostScope === "all"
    ? [sidebarGroupCollapseKey(view, agentGroup, "host", bridgeId), workspaceKey]
    : [workspaceKey];
}

export function filterCollapsedAgentPaneEntries(
  entries: ScopedAgentPane[],
  agentGroup: AgentGroup,
  hostScope: HostScope,
  combineMatchingWorkspaceNames: boolean,
  collapsedGroupKeys: ReadonlySet<string>,
) {
  return entries.filter((entry) =>
    entryCollapseKeys(
      "agents",
      entry.bridgeId,
      entry.pane.workspace_id,
      entry.workspace?.label ?? "workspace",
      agentGroup,
      hostScope,
      combineMatchingWorkspaceNames,
    ).every((key) => !collapsedGroupKeys.has(key)),
  );
}

export function filterCollapsedTabEntries(
  entries: ScopedTabEntry[],
  agentGroup: AgentGroup,
  hostScope: HostScope,
  combineMatchingWorkspaceNames: boolean,
  collapsedGroupKeys: ReadonlySet<string>,
) {
  return entries.filter((entry) =>
    entryCollapseKeys(
      "tabs",
      entry.bridgeId,
      entry.workspace.workspace_id,
      entry.workspace.label,
      agentGroup,
      hostScope,
      combineMatchingWorkspaceNames,
    ).every((key) => !collapsedGroupKeys.has(key)),
  );
}

function filterAgentEntries(
  entries: ScopedAgentPane[],
  pinnedOnly: boolean,
  activeOnly: boolean,
) {
  return entries.filter(
    (entry) =>
      (!pinnedOnly || entry.pinned === true) &&
      (!activeOnly || isActiveAgentStatus(entry.pane.agent_status)),
  );
}

export function buildScopedAgentGroups(
  agentPanes: ScopedAgentPane[],
  agentGroup: AgentGroup,
  combineMatchingWorkspaceNames = false,
) {
  const paneBuckets = new Map<string, ScopedAgentGroup>();
  const groupByWorkspace = agentGroup === "workspace" || agentGroup === "hostWorkspace";
  for (const entry of agentPanes) {
    const workspaceLabel = entry.workspace?.label.trim() || "workspace";
    const key = groupByWorkspace
      ? agentGroup === "workspace" && combineMatchingWorkspaceNames
        ? `workspace-name:${workspaceLabel}`
        : `${entry.bridgeId}:${entry.pane.workspace_id}`
      : entry.bridgeId;
    const label = agentGroup === "host" ? entry.bridgeLabel : workspaceLabel;
    const existing =
      paneBuckets.get(key) ??
      {
        key,
        bridgeId: entry.bridgeId,
        label,
        bridgeColor: entry.bridgeColor,
        status:
          groupByWorkspace && !(agentGroup === "workspace" && combineMatchingWorkspaceNames)
            ? entry.workspace?.agent_status
            : undefined,
        panes: [],
      };
    existing.panes.push(entry);
    paneBuckets.set(key, existing);
  }
  return [...paneBuckets.values()].map((group) => ({
    ...group,
    status: group.status ?? aggregateStatus(group.panes.map((entry) => entry.pane)),
  }));
}

export function buildVisibleTabWorkspaceGroups(
  scopedWorkspaces: ScopedWorkspace[],
  pinnedAgentKeys: ReadonlySet<string> = EMPTY_AGENT_PIN_KEYS,
  pinnedOnly = false,
  agentFeaturesInTabs = false,
  agentSort: AgentSort = "workspace",
  agentActivityTransitions: ReadonlyMap<string, number> = EMPTY_AGENT_ACTIVITY_TRANSITIONS,
  activeOnly = false,
): ScopedTabWorkspace[] {
  return scopedWorkspaces
    .map((entry) => {
      const tabs = sortTabsForWorkspace(entry.snapshot.tabs, entry.workspace.workspace_id)
        .map((tab) => {
          const panes = sortPanesForTab(entry.snapshot.panes, tab.tab_id);
          const pinnedPanes = pinnedOnly
            ? panes.filter((pane) => isAgentPinned(pinnedAgentKeys, entry.bridgeId, pane.pane_id))
            : panes;
          return {
            tab,
            panes:
              agentFeaturesInTabs && activeOnly
                ? pinnedPanes.filter(
                    (pane) => isAgentPane(pane) && isActiveAgentStatus(pane.agent_status),
                  )
                : pinnedPanes,
          };
        })
        .filter((group) => group.panes.length > 0);
      if (!agentFeaturesInTabs) {
        return { ...entry, tabs };
      }
      const sorted = sortScopedTabEntriesByAgents(
        tabs.map(({ tab, panes }) => ({ ...entry, tab, panes })),
        agentSort,
        agentActivityTransitions,
      );
      return {
        ...entry,
        tabs: sorted.map(({ tab, panes }) => ({ tab, panes })),
      };
    })
    .filter((group) => group.tabs.length > 0);
}

export function buildCombinedTabWorkspaceGroups(
  workspaceGroups: ScopedTabWorkspace[],
): CombinedTabWorkspaceGroup[] {
  const buckets = new Map<string, Omit<CombinedTabWorkspaceGroup, "status">>();
  for (const workspaceGroup of workspaceGroups) {
    const label = workspaceGroup.workspace.label.trim() || "workspace";
    const key = `workspace-name:${label}`;
    const bucket = buckets.get(key) ?? { key, label, workspaces: [] };
    bucket.workspaces.push(workspaceGroup);
    buckets.set(key, bucket);
  }
  return [...buckets.values()].map((bucket) => ({
    ...bucket,
    status: aggregateStatus(
      bucket.workspaces.flatMap((workspace) =>
        workspace.tabs.flatMap((tab) => tab.panes),
      ),
    ),
  }));
}

export function buildVisibleTabEntries(
  scopedWorkspaces: ScopedWorkspace[],
  bridgeViews: BridgeConnectionView[],
  hostScope: HostScope,
  agentGroup: AgentGroup,
  pinnedAgentKeys: ReadonlySet<string> = EMPTY_AGENT_PIN_KEYS,
  pinnedOnly = false,
  agentFeaturesInTabs = false,
  agentSort: AgentSort = "workspace",
  agentActivityTransitions: ReadonlyMap<string, number> = EMPTY_AGENT_ACTIVITY_TRANSITIONS,
  activeOnly = false,
  combineMatchingWorkspaceNames = false,
): ScopedTabEntry[] {
  const spaceGroups = buildVisibleTabWorkspaceGroups(
    scopedWorkspaces,
    pinnedAgentKeys,
    pinnedOnly,
    agentFeaturesInTabs,
    agentSort,
    agentActivityTransitions,
    activeOnly,
  );
  const flattenGroup = (group: ScopedTabWorkspace): ScopedTabEntry[] =>
    group.tabs.map(({ tab, panes }) => ({ ...group, tab, panes }));
  if (agentFeaturesInTabs && agentGroup === "none") {
    return sortScopedTabEntriesByAgents(
      spaceGroups.flatMap(flattenGroup),
      agentSort,
      agentActivityTransitions,
    );
  }
  if (agentGroup === "host") {
    return bridgeViews.flatMap((view) =>
      sortScopedTabEntriesByAgents(
        spaceGroups
          .filter((group) => group.bridgeId === view.runtime.id && group.tabs.length > 0)
          .flatMap(flattenGroup),
        agentFeaturesInTabs ? agentSort : "workspace",
        agentActivityTransitions,
      ),
    );
  }
  if (agentGroup === "workspace" && hostScope === "all" && combineMatchingWorkspaceNames) {
    return buildCombinedTabWorkspaceGroups(spaceGroups).flatMap((group) =>
      group.workspaces.flatMap(flattenGroup),
    );
  }
  return spaceGroups.flatMap(flattenGroup);
}

export function sortScopedTabEntriesByAgents(
  entries: ScopedTabEntry[],
  agentSort: AgentSort,
  agentActivityTransitions: ReadonlyMap<string, number> = EMPTY_AGENT_ACTIVITY_TRANSITIONS,
) {
  if (agentSort === "workspace") {
    return [...entries];
  }
  const ranked = entries.map((entry, index) => {
    const agents = entry.panes.filter(isAgentPane);
    let sortRank: number | undefined;
    if (agentSort === "attention" || agentSort === "status") {
      const order = agentSort === "attention" ? AGENT_ATTENTION_ORDER : AGENT_STATUS_ORDER;
      sortRank =
        agents.length > 0
          ? Math.min(...agents.map((pane) => order[pane.agent_status]))
          : undefined;
    } else {
      sortRank = agents.reduce<number | undefined>((latest, pane) => {
        const transition = agentActivityTransitions.get(
          agentActivityKey(entry.bridgeId, pane.pane_id, pane.terminal_id),
        );
        return transition === undefined || (latest !== undefined && latest >= transition)
          ? latest
          : transition;
      }, undefined);
    }
    return { entry, index, agents, sortRank };
  });
  ranked.sort((a, b) => {
    const agentPresence = Number(b.agents.length > 0) - Number(a.agents.length > 0);
    if (agentPresence !== 0) {
      return agentPresence;
    }
    if (a.agents.length === 0) {
      return a.index - b.index;
    }
    if (a.sortRank !== undefined || b.sortRank !== undefined) {
      if (a.sortRank === undefined) {
        return 1;
      }
      if (b.sortRank === undefined) {
        return -1;
      }
      if (a.sortRank !== b.sortRank) {
        if (agentSort === "lastStatusChange") {
          return b.sortRank - a.sortRank;
        }
        return a.sortRank - b.sortRank;
      }
    }
    return a.index - b.index;
  });
  return ranked.map(({ entry }) => entry);
}

export function shouldShowTabDivider(
  agentGroup: AgentGroup,
  workspaceTabCount: number,
  paneCount: number,
) {
  return agentGroup !== "none" && (workspaceTabCount > 1 || paneCount > 1);
}

export function sidebarRowContext(
  agentGroup: AgentGroup,
  hostScope: HostScope,
  bridgeLabel: string,
  workspaceLabel: string,
) {
  return {
    bridgeLabel:
      hostScope === "all" && (agentGroup === "none" || agentGroup === "workspace")
        ? bridgeLabel
        : undefined,
    workspaceLabel:
      agentGroup === "none" || agentGroup === "host" ? workspaceLabel : undefined,
  };
}

export function buildVisibleScopedNotes(
  bridgeViews: BridgeConnectionView[],
  notesStates: Record<string, BridgeNotesState>,
  selectedBridgeId: BridgeId | null,
  hostScope: HostScope,
  scope: Scope,
  activeSpace: WorkspaceInfo | null,
  activeWorkspacesByBridgeId: Record<string, string>,
  multiHostSpaceSelection: boolean,
  includeArchived: boolean,
  includeDeleted: boolean,
  dedupeStores = true,
): ScopedNoteEntry[] {
  const hostBridgeViews = visibleHostBridgeViews(bridgeViews, selectedBridgeId, hostScope);
  const entries = hostBridgeViews.flatMap((view) => {
    if (
      scope === "space" &&
      !multiHostSpaceSelection &&
      view.runtime.id !== selectedBridgeId
    ) {
      return [];
    }
    const notesState = notesStates[view.runtime.id];
    if (!notesState || notesState.connectionKey !== view.runtime.connectionKey) {
      return [];
    }
    const snapshot = view.snapshot;
    const bridgeIndex = Math.max(
      0,
      bridgeViews.findIndex((candidate) => candidate.runtime.id === view.runtime.id),
    );
    const activeWorkspace =
      scope === "space"
        ? activeWorkspaceForBridgeView(
            view,
            selectedBridgeId,
            activeSpace,
            activeWorkspacesByBridgeId,
            multiHostSpaceSelection,
          )
        : null;
    return (notesState.response?.notes ?? [])
      .filter((note) => noteVisibleByLifecycle(note, includeArchived, includeDeleted))
      .filter((note) => noteVisibleInScope(note, activeWorkspace))
      .map((note) => {
        const pane = note.resolved_pane;
        const workspaceId = pane?.workspace_id ?? note.attachment?.workspace_id;
        return {
          bridgeId: view.runtime.id,
          connectionKey: view.runtime.connectionKey,
          storeId: notesState.response?.store_id ?? "unknown-store",
          sessionKey: note.session_key,
          bridgeSessionKey: notesState.response?.session_key ?? note.session_key,
          bridgeIndex,
          bridgeLabel: view.runtime.label,
          bridgeColor: view.runtime.color,
          note,
          snapshot,
          workspace: workspaceId
            ? snapshot?.workspaces.find((workspace) => workspace.workspace_id === workspaceId)
            : undefined,
          pane,
        };
      });
  });
  const visibleEntries =
    dedupeStores && hostScope === "all" ? dedupeScopedNoteEntries(entries) : entries;
  return visibleEntries.sort((a, b) => {
    const bridge = a.bridgeIndex - b.bridgeIndex;
    if (bridge !== 0) {
      return bridge;
    }
    return compareNotes(a.note, b.note);
  });
}

function dedupeScopedNoteEntries(entries: ScopedNoteEntry[]) {
  const byNoteIdentity = new Map<string, ScopedNoteEntry>();
  for (const entry of entries) {
    const identity = scopedNoteIdentity(entry);
    const existing = byNoteIdentity.get(identity);
    if (!existing || shouldPreferScopedNoteEntry(entry, existing)) {
      byNoteIdentity.set(identity, entry);
    }
  }
  return Array.from(byNoteIdentity.values());
}

function scopedNoteIdentity(entry: ScopedNoteEntry) {
  return `${entry.storeId}:${entry.note.session_key}:${entry.note.note_id}`;
}

function shouldPreferScopedNoteEntry(candidate: ScopedNoteEntry, existing: ScopedNoteEntry) {
  const score = (entry: ScopedNoteEntry) =>
    (entry.bridgeSessionKey === entry.note.session_key ? 2 : 0) + (entry.pane ? 1 : 0);
  const candidateScore = score(candidate);
  const existingScore = score(existing);
  if (candidateScore !== existingScore) {
    return candidateScore > existingScore;
  }
  return candidate.bridgeIndex < existing.bridgeIndex;
}

function noteVisibleByLifecycle(
  note: PaneNote,
  includeArchived: boolean,
  includeDeleted: boolean,
) {
  if (note.deleted_at) {
    return includeDeleted;
  }
  if (note.archived_at) {
    return includeArchived;
  }
  return true;
}

function noteVisibleInScope(note: PaneNote, activeWorkspace: WorkspaceInfo | null) {
  if (!activeWorkspace) {
    return true;
  }
  if (note.link_state !== "linked") {
    return true;
  }
  const workspaceId = note.resolved_pane?.workspace_id ?? note.attachment?.workspace_id;
  return !workspaceId || workspaceId === activeWorkspace.workspace_id;
}

function findScopedNote(
  entries: ScopedNoteEntry[],
  ref: ScopedNoteRef | null,
  fallback = true,
) {
  if (!ref) {
    return fallback ? (entries[0] ?? null) : null;
  }
  const found = entries.find(
    (entry) => entry.bridgeId === ref.bridgeId && entry.note.note_id === ref.noteId,
  );
  return found ?? (fallback ? (entries[0] ?? null) : null);
}

function scopedNoteLinkedToPane(
  entry: ScopedNoteEntry,
  bridgeId: BridgeId | null,
  paneId: string | null | undefined,
) {
  return Boolean(
    bridgeId &&
      paneId &&
      entry.bridgeId === bridgeId &&
      entry.note.link_state === "linked" &&
      entry.note.attachment?.pane_id === paneId &&
      entry.pane?.pane_id === paneId,
  );
}

function noteStateLabel(note: PaneNote) {
  if (note.deleted_at) {
    return { label: "deleted", status: "blocked" as AgentStatus };
  }
  if (note.archived_at) {
    return { label: "archived", status: "idle" as AgentStatus };
  }
  if (note.link_state === "linked") {
    return { label: "linked", status: "done" as AgentStatus };
  }
  if (note.link_state === "unresolved") {
    return { label: "unresolved", status: "working" as AgentStatus };
  }
  return { label: "detached", status: "unknown" as AgentStatus };
}

function NoteStateIcon({
  note,
  label,
  status,
}: {
  note: PaneNote;
  label: string;
  status: AgentStatus;
}) {
  const icon = note.deleted_at ? (
    <Trash2 size={14} />
  ) : note.archived_at ? (
    <Archive size={14} />
  ) : note.link_state === "linked" ? (
    <SquareTerminal size={14} />
  ) : note.link_state === "unresolved" ? (
    <Link2 size={14} />
  ) : (
    <Unlink size={14} />
  );
  return (
    <span className="note-state-icon" data-status={status} aria-label={label}>
      {icon}
    </span>
  );
}

function noteSubtitle(entry: ScopedNoteEntry, showBridge: boolean) {
  const context = entry.note.attachment?.context;
  const paneLabel =
    entry.pane ? paneTitle(entry.pane) : context?.pane_label || context?.pane_title;
  const cwd = basename(context?.foreground_cwd || context?.cwd);
  return [
    showBridge ? entry.bridgeLabel : null,
    entry.workspace?.label,
    paneLabel,
    cwd,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function shouldBlockDirtyNoteAutosave({
  dirty,
  title,
  body,
  baseRevision,
  serverTitle,
  serverBody,
  serverRevision,
}: {
  dirty: boolean;
  title: string;
  body: string;
  baseRevision: number | null;
  serverTitle: string;
  serverBody: string;
  serverRevision: number;
}) {
  if (!dirty || baseRevision === null || serverRevision <= baseRevision) {
    return false;
  }
  return title !== serverTitle || body !== serverBody;
}

export function isInFlightNoteSaveVisible({
  inFlight,
  noteIdentity,
  serverRevision,
  serverTitle,
  serverBody,
}: {
  inFlight: NoteSaveInFlight | null;
  noteIdentity: string;
  serverRevision: number;
  serverTitle: string;
  serverBody: string;
}) {
  return Boolean(
    inFlight &&
      inFlight.noteIdentity === noteIdentity &&
      serverRevision > inFlight.expectedRevision &&
      serverTitle === inFlight.title &&
      serverBody === inFlight.body,
  );
}

export function noteDraftStorageKey(entry: ScopedNoteEntry) {
  return `${NOTE_DRAFT_STORAGE_PREFIX}${[
    entry.bridgeId,
    entry.connectionKey,
    entry.storeId,
    entry.sessionKey,
    entry.note.note_id,
  ]
    .map((part) => encodeURIComponent(part))
    .join(":")}`;
}

function readNoteDraft(entry: ScopedNoteEntry): NoteDraft | null {
  try {
    const raw = globalThis.localStorage?.getItem(noteDraftStorageKey(entry));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<NoteDraft>;
    if (
      typeof parsed.title !== "string" ||
      typeof parsed.body !== "string" ||
      typeof parsed.baseRevision !== "number"
    ) {
      return null;
    }
    return {
      title: parsed.title,
      body: parsed.body,
      baseRevision: parsed.baseRevision,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

function writeNoteDraft(
  entry: ScopedNoteEntry,
  title: string,
  body: string,
  baseRevision: number,
) {
  try {
    const draft: NoteDraft = {
      title,
      body,
      baseRevision,
      updatedAt: Date.now(),
    };
    globalThis.localStorage?.setItem(noteDraftStorageKey(entry), JSON.stringify(draft));
  } catch {
    // Draft persistence is best-effort; the bridge remains the durable source.
  }
}

function clearNoteDraft(entry: ScopedNoteEntry) {
  try {
    globalThis.localStorage?.removeItem(noteDraftStorageKey(entry));
  } catch {
    // Ignore storage failures.
  }
}

function readNoteEditorMode(): NoteEditorMode {
  try {
    return globalThis.localStorage?.getItem(NOTE_EDITOR_MODE_STORAGE_KEY) === "preview"
      ? "preview"
      : "edit";
  } catch {
    return "edit";
  }
}

function writeNoteEditorMode(mode: NoteEditorMode) {
  try {
    globalThis.localStorage?.setItem(NOTE_EDITOR_MODE_STORAGE_KEY, mode);
  } catch {
    // Ignore storage failures.
  }
}

export function nextVisibleAgentPaneEntry(
  entries: ScopedAgentPane[],
  currentIndex: number,
  step: -1 | 1,
): ScopedAgentPane {
  return entries[nextVisibleEntryIndex(entries.length, currentIndex, step)];
}

export function nextVisibleTabEntry(
  entries: ScopedTabEntry[],
  currentIndex: number,
  step: -1 | 1,
): ScopedTabEntry {
  return entries[nextVisibleEntryIndex(entries.length, currentIndex, step)];
}

function nextVisibleEntryIndex(length: number, currentIndex: number, step: -1 | 1) {
  if (length === 0) {
    throw new Error("cannot navigate an empty visible entry list");
  }
  if (currentIndex === -1) {
    return step > 0 ? 0 : length - 1;
  }
  return (currentIndex + step + length) % length;
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
  theme,
  terminalFontSizePx,
  terminalScreenReaderText,
  mobileControlsScalePercent,
  mobileCompactControls,
  onMobileCompactControlsChange,
  mobileTapTarget,
  mobileLongPressBehavior,
  mobileTouchSelectionEndpointTimeoutMs,
  mobileCommandExpandingInput,
  mobileCommandEnterNewline,
  terminalInputTransport,
  terminalInputBatchDelayMs,
  terminalOutputCoalesceMs,
  connectionKey,
  resumeToken,
  httpUrl,
  wsUrl,
  onNextAgentPane,
  onPrevAgentPane,
  pinned,
  onPaneCycle,
  onPaneCycleModeToggle,
  paneCycleMode,
}: {
  cells: { pane: PaneInfo; style: CSSProperties }[];
  selectedPaneId: string | null;
  onSelectPane: (pane: PaneInfo) => void;
  refitToken: number;
  focusToken: number;
  touchInput: boolean;
  theme: Theme;
  terminalFontSizePx: number;
  terminalScreenReaderText: boolean;
  mobileControlsScalePercent: number;
  mobileCompactControls: boolean;
  onMobileCompactControlsChange: (compact: boolean) => void;
  mobileTapTarget: MobileTerminalTapTarget;
  mobileLongPressBehavior: MobileLongPressBehavior;
  mobileTouchSelectionEndpointTimeoutMs: MobileTouchSelectionEndpointTimeoutMs;
  mobileCommandExpandingInput: boolean;
  mobileCommandEnterNewline: boolean;
  terminalInputTransport: TerminalInputTransport;
  terminalInputBatchDelayMs: number;
  terminalOutputCoalesceMs: number;
  connectionKey: string;
  resumeToken: number;
  httpUrl: (path: string, query?: URLSearchParams) => string;
  wsUrl: (path: string, query?: URLSearchParams) => string;
  onNextAgentPane: () => void;
  onPrevAgentPane: () => void;
  pinned: boolean;
  onPaneCycle: (direction: "next" | "prev") => void;
  onPaneCycleModeToggle: () => void;
  paneCycleMode: "pin" | "all";
}) {
  // On touch devices, showing every split pane at once (e.g. a small tmux
  // status pane stacked under the main agent pane) leaves too little room for
  // any one of them to be usable — collapse to just the selected pane, with an
  // escape hatch to see the full grid again.
  const [showAllPanes, setShowAllPanes] = useState(false);
  const singlePaneMode = touchInput && cells.length > 1 && !showAllPanes;

  return (
    <div className="pane-grid" aria-label="Split panes" data-single-pane={singlePaneMode}>
      {touchInput && cells.length > 1 ? (
        <button
          type="button"
          className="pane-grid-toggle"
          aria-label={singlePaneMode ? "Show all panes" : "Show only selected pane"}
          title={singlePaneMode ? "Show all panes" : "Show only selected pane"}
          onClick={() => setShowAllPanes((value) => !value)}
        >
          {singlePaneMode ? <SplitSquareHorizontal size={14} /> : <SquareTerminal size={14} />}
        </button>
      ) : null}
      {cells.map(({ pane, style }, index) => {
        const selected = pane.pane_id === selectedPaneId;
        const hiddenInSinglePaneMode = singlePaneMode && !selected;
        const cellStyle = hiddenInSinglePaneMode
          ? HIDDEN_PANE_CELL_STYLE
          : singlePaneMode
            ? SINGLE_PANE_CELL_STYLE
            : style;
        const accessibilityLabel = `Pane ${index + 1} of ${cells.length} terminal: ${paneTitle(pane)}`;
        return (
          <div
            key={pane.pane_id}
            className="pane-cell"
            data-selected={selected}
            style={cellStyle}
            aria-hidden={hiddenInSinglePaneMode}
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
              // Unified input composer on every device; still only the selected split
              // pane gets the controls bar (pane selection, not pointer type).
              mobileControls={selected}
              cursorBlink={!touchInput}
              theme={theme}
              terminalFontSizePx={terminalFontSizePx}
              terminalScreenReaderText={terminalScreenReaderText}
              mobileControlsScalePercent={mobileControlsScalePercent}
              mobileCompactControls={mobileCompactControls}
              onMobileCompactControlsChange={onMobileCompactControlsChange}
              mobileTapTarget={mobileTapTarget}
              mobileLongPressBehavior={mobileLongPressBehavior}
              mobileTouchSelectionEndpointTimeoutMs={mobileTouchSelectionEndpointTimeoutMs}
              mobileCommandExpandingInput={mobileCommandExpandingInput}
              mobileCommandEnterNewline={mobileCommandEnterNewline}
              terminalInputTransport={terminalInputTransport}
              terminalInputBatchDelayMs={terminalInputBatchDelayMs}
              terminalOutputCoalesceMs={terminalOutputCoalesceMs}
              refitToken={selected ? refitToken : 0}
              focusToken={selected ? focusToken : 0}
              onNextAgentPane={onNextAgentPane}
              onPrevAgentPane={onPrevAgentPane}
              pinned={pinned}
              onPaneCycle={onPaneCycle}
              onPaneCycleModeToggle={onPaneCycleModeToggle}
              paneCycleMode={paneCycleMode}
              accessibilityLabel={accessibilityLabel}
              selected={selected}
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
    <div className="tabbar">
      <div className="tabbar-scroll" role="tablist" aria-label="Tabs">
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
                focusOverlayTrigger(event.currentTarget);
                onMenu("tab", tab.tab_id, label, event.clientX, event.clientY, canClearTabName(tab));
              }}
              onKeyDown={(event) => {
                if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) {
                  return;
                }
                event.preventDefault();
                focusOverlayTrigger(event.currentTarget);
                const rect = event.currentTarget.getBoundingClientRect();
                onMenu("tab", tab.tab_id, label, rect.left, rect.bottom, canClearTabName(tab));
              }}
            >
              <span className="dot" data-status={tab.agent_status} />
              <span className="tabbar-name">{label}</span>
            </button>
          );
        })}
      </div>
      <button
        className="tabbar-add"
        type="button"
        aria-label="New tab"
        title="New tab"
        onClick={(event) => {
          focusOverlayTrigger(event.currentTarget);
          onCreateTab(activeSpace.workspace_id);
        }}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

function Switcher({
  bridgeViews,
  selectedBridgeId,
  hostScope,
  snapshot,
  loadState,
  bridgeCanConnect,
  bridgeError,
  bridgeLabel,
  bridgeMode,
  capabilityState,
  scope,
  sidebarView,
  notesEnabled,
  notesStates,
  visibleNotes,
  selectedNote,
  agentActivityTransitions,
  pinnedAgentKeys,
  agentPinnedOnly,
  agentActiveOnly,
  agentFeaturesInTabs,
  agentSort,
  agentGroup,
  combineMatchingWorkspaceNames,
  collapsedSidebarGroupKeys,
  spaceGroup,
  spaceReorderMode,
  spaceReorderBusy,
  multiHostSpaceSelection,
  activeSpace,
  activeWorkspacesByBridgeId,
  selectedPane,
  onHostScope,
  onScope,
  onSidebarView,
  onSelectNote,
  onCreateNote,
  onAgentPinnedOnly,
  onAgentActiveOnly,
  onAgentSort,
  onAgentGroup,
  onToggleCollapsedGroup,
  onSetCollapsedGroups,
  onSpaceGroup,
  onCancelSpaceReorder,
  onAnnounceSpaceReorder,
  onReorderSpace,
  onSelectBridge,
  onSelectSpace,
  onSelectTab,
  onSelectPane,
  onRefresh,
  onRefreshBridge,
  onBackendSettings,
  theme,
  onToggleTheme,
  onCreateSpace,
  onCreateTab,
  onScopedMenu,
}: {
  bridgeViews: BridgeConnectionView[];
  selectedBridgeId: BridgeId | null;
  hostScope: HostScope;
  snapshot: Snapshot | null;
  loadState: LoadState;
  bridgeCanConnect: boolean;
  bridgeError: string | null;
  bridgeLabel: string;
  bridgeMode: "same-origin" | "configured" | "disconnected";
  capabilityState: "idle" | "probing" | "ready" | "error";
  scope: Scope;
  sidebarView: SidebarView;
  notesEnabled: boolean;
  notesStates: Record<string, BridgeNotesState>;
  visibleNotes: ScopedNoteEntry[];
  selectedNote: ScopedNoteEntry | null;
  agentActivityTransitions: ReadonlyMap<string, number>;
  pinnedAgentKeys: ReadonlySet<string>;
  agentPinnedOnly: boolean;
  agentActiveOnly: boolean;
  agentFeaturesInTabs: boolean;
  agentSort: AgentSort;
  agentGroup: AgentGroup;
  combineMatchingWorkspaceNames: boolean;
  collapsedSidebarGroupKeys: ReadonlySet<string>;
  spaceGroup: SpaceGroup;
  spaceReorderMode: SpaceReorderMode | null;
  spaceReorderBusy: boolean;
  multiHostSpaceSelection: boolean;
  activeSpace: WorkspaceInfo | null;
  activeWorkspacesByBridgeId: Record<string, string>;
  selectedPane: PaneInfo | null;
  onHostScope: (scope: HostScope) => void;
  onScope: (scope: Scope) => void;
  onSidebarView: (view: SidebarView) => void;
  onSelectNote: (bridgeId: BridgeId, noteId: string) => void;
  onCreateNote: () => void;
  onAgentPinnedOnly: (pinnedOnly: boolean) => void;
  onAgentActiveOnly: (activeOnly: boolean) => void;
  onAgentSort: (sort: AgentSort) => void;
  onAgentGroup: (group: AgentGroup) => void;
  onToggleCollapsedGroup: (key: string) => void;
  onSetCollapsedGroups: (keys: readonly string[], collapsed: boolean) => void;
  onSpaceGroup: (group: SpaceGroup) => void;
  onCancelSpaceReorder: () => void;
  onAnnounceSpaceReorder: (message: string) => void;
  onReorderSpace: (
    bridgeId: BridgeId,
    workspaceId: string,
    beforeWorkspaceId: string | null,
    keepMode?: boolean,
  ) => Promise<boolean>;
  onSelectBridge: (bridgeId: BridgeId) => void;
  onSelectSpace: (bridgeId: BridgeId, workspaceId: string) => void;
  onSelectTab: (bridgeId: BridgeId, tabId: string) => void;
  onSelectPane: (bridgeId: BridgeId, pane: PaneInfo) => void;
  onRefresh: () => void;
  onRefreshBridge: (bridgeId: BridgeId) => void;
  onBackendSettings: () => void;
  theme: Theme;
  onToggleTheme: () => void;
  onCreateSpace: () => void;
  onCreateTab: (bridgeId: BridgeId, workspaceId: string) => void;
  onScopedMenu: (
    kind: MenuKind,
    bridgeId: BridgeId,
    id: string,
    label: string,
    x: number,
    y: number,
    clearable?: boolean,
    pinLabel?: "agent" | "pane",
  ) => void;
}) {
  const [optionsMenu, setOptionsMenu] = useState<{ x: number; y: number } | null>(null);
  const [agentSearch, setAgentSearch] = useState("");
  useEffect(() => {
    if (sidebarView !== "agents") {
      setAgentSearch("");
    }
  }, [sidebarView]);
  const [spaceOptionsMenu, setSpaceOptionsMenu] = useState<{ x: number; y: number } | null>(null);
  const [spaceDragTarget, setSpaceDragTarget] = useState<string | null | undefined>(undefined);
  const spaceDragRef = useRef<SpaceDragState | null>(null);
  const spaceListRef = useRef<HTMLDivElement | null>(null);
  const spaceRowRefs = useRef(new Map<string, HTMLDivElement>());
  const spaceReorderCardRef = useRef<HTMLButtonElement | null>(null);
  const selectedBridgeView = selectedBridgeId
    ? (bridgeViews.find((view) => view.runtime.id === selectedBridgeId) ?? null)
    : null;
  const hostBridgeViews = visibleHostBridgeViews(bridgeViews, selectedBridgeId, hostScope);
  const activeWorkspaceForView = useCallback(
    (view: BridgeConnectionView) =>
      activeWorkspaceForBridgeView(
        view,
        selectedBridgeId,
        activeSpace,
        activeWorkspacesByBridgeId,
        multiHostSpaceSelection,
      ),
    [
      activeSpace,
      activeWorkspacesByBridgeId,
      multiHostSpaceSelection,
      selectedBridgeId,
    ],
  );
  const spaceEntries = hostBridgeViews.flatMap((view) => {
    const viewSnapshot = view.snapshot;
    if (!viewSnapshot) {
      return [];
    }
    const activeWorkspace = activeWorkspaceForView(view);
    return viewSnapshot.workspaces.map((workspace) => {
      const workspacePanes = viewSnapshot.panes.filter(
        (pane) => pane.workspace_id === workspace.workspace_id,
      );
      return {
        view,
        workspace,
        workspacePanes,
        active: workspace.workspace_id === activeWorkspace?.workspace_id,
      };
    });
  });
  const reorderBridgeView = spaceReorderMode
    ? (hostBridgeViews.find((view) => view.runtime.id === spaceReorderMode.bridgeId) ?? null)
    : null;
  const reorderWorkspaces = reorderBridgeView?.snapshot?.workspaces ?? [];
  const reorderBlockIds = useMemo(
    () =>
      spaceReorderMode
        ? workspaceReorderBlockIds(reorderWorkspaces, spaceReorderMode.workspaceId)
        : [],
    [reorderWorkspaces, spaceReorderMode],
  );
  const reorderBlockIdSet = useMemo(() => new Set(reorderBlockIds), [reorderBlockIds]);
  const reorderRootIds = useMemo(
    () => workspaceReorderRoots(reorderWorkspaces).map((workspace) => workspace.workspace_id),
    [reorderWorkspaces],
  );
  const reorderSourceRootId = spaceReorderMode?.workspaceId ?? null;
  const reorderSourceLabel = spaceReorderMode
    ? (reorderWorkspaces.find(
        (workspace) => workspace.workspace_id === spaceReorderMode.workspaceId,
      )?.label ?? "Space")
    : "Space";
  const remainingReorderRootIds = useMemo(
    () => reorderRootIds.filter((workspaceId) => workspaceId !== reorderSourceRootId),
    [reorderRootIds, reorderSourceRootId],
  );
  const finalReorderWorkspaceId = useMemo(() => {
    const finalRootId = remainingReorderRootIds.at(-1);
    if (!finalRootId) {
      return null;
    }
    return workspaceReorderBlockIds(reorderWorkspaces, finalRootId).at(-1) ?? finalRootId;
  }, [remainingReorderRootIds, reorderWorkspaces]);
  const canGroupSpacesByHost = shouldOfferSpaceHostGrouping(hostScope, hostBridgeViews.length);
  const effectiveSpaceGroup = resolveEffectiveSpaceGroup(
    spaceGroup,
    hostScope,
    hostBridgeViews.length,
  );
  const scopedWorkspaces = useMemo<ScopedWorkspace[]>(
    () =>
      buildVisibleScopedWorkspaces(
        bridgeViews,
        selectedBridgeId,
        hostScope,
        scope,
        activeSpace,
        activeWorkspacesByBridgeId,
        multiHostSpaceSelection,
      ),
    [
      activeSpace,
      activeWorkspacesByBridgeId,
      bridgeViews,
      hostScope,
      multiHostSpaceSelection,
      scope,
      selectedBridgeId,
    ],
  );
  const panes = scopedWorkspaces.flatMap((entry) =>
    entry.snapshot.panes.filter((pane) => pane.workspace_id === entry.workspace.workspace_id),
  );
  const roll = aggregateStatus(panes);
  const headerSummary = summary(panes);
  const bridgeBlocked =
    bridgeViews.length === 0 ||
    (hostScope === "selected" && (!selectedBridgeView || !bridgeCanConnect));
  const disconnectedBridgeViews =
    hostScope === "all"
      ? bridgeViews.filter(
          (view) => !view.snapshot && (!view.runtime.canConnect || view.loadState === "error"),
        )
      : [];
  const notesSupported =
    notesEnabled && hostBridgeViews.some((view) => supportsNotes(view.runtime.capabilities));
  const agentPinsSupported = hostBridgeViews.some((view) =>
    supportsAgentPins(view.runtime.capabilities),
  );
  const showLastStatusChangeSort = shouldShowLastStatusChangeSort(
    hostBridgeViews.some((view) => supportsAgentActivity(view.runtime.capabilities)),
    agentSort,
  );
  const effectiveAgentPinnedOnly = agentPinsSupported && agentPinnedOnly;
  const combineWorkspaceGroups =
    combineMatchingWorkspaceNames && hostScope === "all" && agentGroup === "workspace";
  const notesLoading = notesEnabled && hostBridgeViews.some(
    (view) => notesStates[view.runtime.id]?.loadState === "loading",
  );
  const notesError = notesEnabled
    ? hostBridgeViews
        .map((view) => notesStates[view.runtime.id]?.error)
        .find((message): message is string => Boolean(message))
    : undefined;
  const notesViewActive = notesEnabled && sidebarView === "notes";
  const hasNotesList =
    notesViewActive &&
    (notesSupported || visibleNotes.length > 0 || notesLoading || notesError);
  const hasListSnapshot =
    hasNotesList ||
    (hostScope === "all"
      ? hostBridgeViews.some((view) => view.snapshot) || disconnectedBridgeViews.length > 0
      : Boolean(snapshot));

  const agentPanes = useMemo<ScopedAgentPane[]>(() => {
    return buildVisibleAgentPaneEntries(
      scopedWorkspaces,
      bridgeViews,
      hostScope,
      agentSort === "lastStatusChange" ? agentGroup : "none",
      agentSort,
      pinnedAgentKeys,
      effectiveAgentPinnedOnly,
      agentActivityTransitions,
      agentActiveOnly,
      combineWorkspaceGroups,
    );
  }, [
    agentActivityTransitions,
    agentActiveOnly,
    agentGroup,
    effectiveAgentPinnedOnly,
    agentSort,
    bridgeViews,
    combineWorkspaceGroups,
    hostScope,
    pinnedAgentKeys,
    scopedWorkspaces,
  ]);

  const agentSearchTrimmed = agentSearch.trim().toLowerCase();
  const filteredAgentPanes = useMemo<ScopedAgentPane[]>(() => {
    if (!agentSearchTrimmed) {
      return agentPanes;
    }
    return agentPanes.filter((entry) => {
      const title = paneTitle(entry.pane).toLowerCase();
      const meta = paneMeta(entry.pane).toLowerCase();
      const workspace = (entry.workspace?.label ?? "").toLowerCase();
      const tab = (entry.tabLabel ?? "").toLowerCase();
      return (
        title.includes(agentSearchTrimmed) ||
        meta.includes(agentSearchTrimmed) ||
        workspace.includes(agentSearchTrimmed) ||
        tab.includes(agentSearchTrimmed)
      );
    });
  }, [agentPanes, agentSearchTrimmed]);

  const agentGroups = useMemo(() => {
    if (agentGroup === "none") {
      return [];
    }
    return buildScopedAgentGroups(agentSearchTrimmed ? filteredAgentPanes : agentPanes, agentGroup, combineWorkspaceGroups);
  }, [agentGroup, agentPanes, filteredAgentPanes, agentSearchTrimmed, combineWorkspaceGroups]);

  const spaceGroups = useMemo<ScopedTabWorkspace[]>(
    () =>
      buildVisibleTabWorkspaceGroups(
        scopedWorkspaces,
        pinnedAgentKeys,
        sidebarView === "tabs" && effectiveAgentPinnedOnly,
        sidebarView === "tabs" && agentFeaturesInTabs,
        agentSort,
        agentActivityTransitions,
        sidebarView === "tabs" && agentFeaturesInTabs && agentActiveOnly,
      ),
    [
      agentActivityTransitions,
      agentActiveOnly,
      agentFeaturesInTabs,
      agentSort,
      effectiveAgentPinnedOnly,
      pinnedAgentKeys,
      scopedWorkspaces,
      sidebarView,
    ],
  );
  const combinedTabWorkspaceGroups = useMemo(
    () => (combineWorkspaceGroups ? buildCombinedTabWorkspaceGroups(spaceGroups) : []),
    [combineWorkspaceGroups, spaceGroups],
  );
  const flatTabEntries = useMemo(
    () =>
      sortScopedTabEntriesByAgents(
        spaceGroups.flatMap((group) =>
          group.tabs.map(({ tab, panes: tabPanes }) => ({
            ...group,
            tab,
            panes: tabPanes,
          })),
        ),
        agentFeaturesInTabs ? agentSort : "workspace",
        agentActivityTransitions,
      ),
    [agentActivityTransitions, agentFeaturesInTabs, agentSort, spaceGroups],
  );
  const spaceCount = spaceEntries.length;
  const showGroupedHostContext = hostScope === "all";
  const showGroupControl =
    sidebarView !== "notes" &&
    (sidebarView === "agents" || hostScope === "all" || scope === "all" || agentGroup !== "none");
  const showOptionsControl =
    sidebarView !== "notes" &&
    (sidebarView === "agents" ||
      showGroupControl ||
      (sidebarView === "tabs" && agentFeaturesInTabs));
  const canCreateTabFromHeader = Boolean(
    sidebarView === "tabs" &&
      scope === "space" &&
      activeSpace &&
      selectedBridgeId,
  );
  const canCreateNoteFromHeader = notesViewActive && notesSupported;
  const showPinnedOnlyControl =
    (sidebarView === "agents" || sidebarView === "tabs") && agentPinsSupported;
  const showActiveOnlyControl =
    sidebarView === "agents" || (sidebarView === "tabs" && agentFeaturesInTabs);
  const pinnedOnlyLabel = sidebarView === "tabs" ? "pinned panes" : "pinned agents";
  const paneGroupCollapseKeys = (() => {
    if (sidebarView === "agents") {
      if (agentGroup === "none") {
        return [];
      }
      if (agentGroup === "hostWorkspace" && hostScope === "all") {
        return hostBridgeViews.flatMap((view) => {
          const groups = agentGroups.filter((group) => group.bridgeId === view.runtime.id);
          if (groups.length === 0) {
            return [];
          }
          return [
            sidebarGroupCollapseKey("agents", agentGroup, "host", view.runtime.id),
            ...groups.map((group) =>
              sidebarGroupCollapseKey("agents", agentGroup, "workspace", group.key),
            ),
          ];
        });
      }
      const level = agentGroup === "host" ? "host" : "workspace";
      return agentGroups.map((group) =>
        sidebarGroupCollapseKey("agents", agentGroup, level, group.key),
      );
    }

    if (sidebarView !== "tabs" || agentGroup === "none") {
      return [];
    }
    if (agentGroup === "host") {
      return hostBridgeViews.flatMap((view) =>
        flatTabEntries.some(
          (entry) => entry.bridgeId === view.runtime.id && entry.panes.length > 0,
        )
          ? [sidebarGroupCollapseKey("tabs", agentGroup, "host", view.runtime.id)]
          : [],
      );
    }
    if (agentGroup === "hostWorkspace" && hostScope === "all") {
      return hostBridgeViews.flatMap((view) => {
        const groups = spaceGroups.filter(
          (group) => group.bridgeId === view.runtime.id && group.tabs.length > 0,
        );
        if (groups.length === 0) {
          return [];
        }
        return [
          sidebarGroupCollapseKey("tabs", agentGroup, "host", view.runtime.id),
          ...groups.map((group) =>
            sidebarGroupCollapseKey(
              "tabs",
              agentGroup,
              "workspace",
              `${group.bridgeId}:${group.workspace.workspace_id}`,
            ),
          ),
        ];
      });
    }
    if (combineWorkspaceGroups) {
      return combinedTabWorkspaceGroups.map((group) =>
        sidebarGroupCollapseKey("tabs", agentGroup, "workspace", group.key),
      );
    }
    return spaceGroups.flatMap((group) =>
      group.tabs.length > 0
        ? [
            sidebarGroupCollapseKey(
              "tabs",
              agentGroup,
              "workspace",
              `${group.bridgeId}:${group.workspace.workspace_id}`,
            ),
          ]
        : [],
    );
  })();
  const allPaneGroupsCollapsed = areAllVisibleSidebarGroupsCollapsed(
    paneGroupCollapseKeys,
    agentGroup,
    hostScope,
    collapsedSidebarGroupKeys,
  );

  useEffect(() => {
    if (optionsMenu && !showOptionsControl) {
      setOptionsMenu(null);
    }
  }, [optionsMenu, showOptionsControl]);

  useEffect(() => {
    if (spaceOptionsMenu && !canGroupSpacesByHost) {
      setSpaceOptionsMenu(null);
    }
  }, [canGroupSpacesByHost, spaceOptionsMenu]);

  useEffect(() => {
    if (!spaceReorderMode) {
      spaceDragRef.current = null;
      setSpaceDragTarget(undefined);
      return;
    }
    if (!reorderBridgeView?.snapshot || reorderBlockIds.length === 0) {
      onCancelSpaceReorder();
    }
  }, [onCancelSpaceReorder, reorderBlockIds.length, reorderBridgeView?.snapshot, spaceReorderMode]);

  useEffect(() => {
    if (!spaceReorderMode) {
      return;
    }
    const frame = window.requestAnimationFrame(() => spaceReorderCardRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [spaceReorderMode?.bridgeId, spaceReorderMode?.workspaceId]);

  const rowRefKey = (bridgeId: BridgeId, workspaceId: string) =>
    `${bridgeId}:${workspaceId}`;
  const setSpaceRowRef = (
    bridgeId: BridgeId,
    workspaceId: string,
    node: HTMLDivElement | null,
  ) => {
    const key = rowRefKey(bridgeId, workspaceId);
    if (node) {
      spaceRowRefs.current.set(key, node);
    } else {
      spaceRowRefs.current.delete(key);
    }
  };
  const reorderTargetAtY = (clientY: number) => {
    if (!spaceReorderMode) {
      return null;
    }
    for (const rootId of remainingReorderRootIds) {
      const blockIds = workspaceReorderBlockIds(reorderWorkspaces, rootId);
      const firstRow = spaceRowRefs.current.get(rowRefKey(spaceReorderMode.bridgeId, rootId));
      const lastRow = spaceRowRefs.current.get(
        rowRefKey(spaceReorderMode.bridgeId, blockIds.at(-1) ?? rootId),
      );
      if (firstRow && lastRow) {
        const firstRect = firstRow.getBoundingClientRect();
        const lastRect = lastRow.getBoundingClientRect();
        if (clientY < (firstRect.top + lastRect.bottom) / 2) {
          return rootId;
        }
      }
    }
    return null;
  };
  const updateSpaceDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = spaceDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const listRect = spaceListRef.current?.getBoundingClientRect();
    if (listRect) {
      const edge = 42;
      if (event.clientY < listRect.top + edge) {
        spaceListRef.current?.scrollBy({ top: -12 });
      } else if (event.clientY > listRect.bottom - edge) {
        spaceListRef.current?.scrollBy({ top: 12 });
      }
    }
    const beforeWorkspaceId = reorderTargetAtY(event.clientY);
    const moved = drag.moved || Math.abs(event.clientY - drag.startY) > 5;
    spaceDragRef.current = { ...drag, beforeWorkspaceId, moved };
    setSpaceDragTarget(moved ? beforeWorkspaceId : undefined);
  };
  const finishSpaceDrag = (event: ReactPointerEvent<HTMLButtonElement>, commit: boolean) => {
    const drag = spaceDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !spaceReorderMode) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    spaceDragRef.current = null;
    setSpaceDragTarget(undefined);
    if (commit && drag.moved) {
      void onReorderSpace(
        spaceReorderMode.bridgeId,
        spaceReorderMode.workspaceId,
        drag.beforeWorkspaceId,
      ).then((moved) => {
        if (moved) {
          onAnnounceSpaceReorder(`Moved ${reorderSourceLabel}.`);
        }
      });
    }
  };
  const beginSpaceDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (
      !spaceReorderMode ||
      spaceReorderBusy ||
      (event.button !== 0 && event.pointerType !== "touch")
    ) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    spaceDragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      beforeWorkspaceId: reorderTargetAtY(event.clientY),
      moved: false,
    };
  };
  const moveSpaceWithKeyboard = (direction: WorkspaceReorderDirection) => {
    if (!spaceReorderMode || spaceReorderBusy) {
      return;
    }
    const destination = workspaceReorderDestination(
      reorderWorkspaces,
      spaceReorderMode.workspaceId,
      direction,
    );
    if (destination === undefined) {
      const boundaryLabel: Record<WorkspaceReorderDirection, string> = {
        up: "is already at the beginning",
        down: "is already at the end",
        top: "is already at the beginning",
        bottom: "is already at the end",
      };
      onAnnounceSpaceReorder(`${reorderSourceLabel} ${boundaryLabel[direction]}.`);
      return;
    }
    void onReorderSpace(
      spaceReorderMode.bridgeId,
      spaceReorderMode.workspaceId,
      destination,
      true,
    ).then((moved) => {
      if (!moved) {
        return;
      }
      const destinationLabel: Record<WorkspaceReorderDirection, string> = {
        up: "up one position",
        down: "down one position",
        top: "to the beginning",
        bottom: "to the end",
      };
      onAnnounceSpaceReorder(`Moved ${reorderSourceLabel} ${destinationLabel[direction]}.`);
      window.requestAnimationFrame(() => spaceReorderCardRef.current?.focus());
    });
  };
  const cancelSpaceReorder = () => {
    onCancelSpaceReorder();
  };

  let agentPaneIndex = 0;
  let paneIndex = 0;
  const renderTabWorkspaceGroup = (
    group: ScopedTabWorkspace,
    showWorkspaceHeader: boolean,
    showBridgeInWorkspaceHeader = showGroupedHostContext,
    key = `${group.bridgeId}:${group.workspace.workspace_id}`,
    collapseKey?: string,
    nestedHeader = false,
  ) => {
    const collapsed = collapseKey ? collapsedSidebarGroupKeys.has(collapseKey) : false;
    const paneCount = group.tabs.reduce((total, tab) => total + tab.panes.length, 0);
    const tabRows = collapsed
      ? null
      : group.tabs.map(({ tab, panes: tabPanes }) => {
          const tabLabel = displayTabLabel(tab, group.snapshot.panes);
          const rowContext = sidebarRowContext(
            agentGroup,
            hostScope,
            group.bridgeLabel,
            group.workspace.label,
          );
          const paneRows = tabPanes.map((pane) => {
            const index = paneIndex++;
            const pinned = isAgentPinned(pinnedAgentKeys, group.bridgeId, pane.pane_id);
            const renderAsAgent = shouldRenderAgentRowInTabs(pane, agentFeaturesInTabs);
            const active =
              group.bridgeId === selectedBridgeId && pane.pane_id === selectedPane?.pane_id;
            const onSelect = () => onSelectPane(group.bridgeId, pane);
            const onPaneMenu = (x: number, y: number) =>
              onScopedMenu(
                "pane",
                group.bridgeId,
                pane.pane_id,
                paneTitle(pane),
                x,
                y,
                undefined,
                renderAsAgent ? "agent" : "pane",
              );
            if (renderAsAgent) {
              return (
                <AgentRow
                  key={`${group.bridgeId}:${pane.pane_id}`}
                  index={index}
                  pane={pane}
                  workspace={rowContext.workspaceLabel ? group.workspace : undefined}
                  tabLabel={tabLabel}
                  bridgeLabel={rowContext.bridgeLabel}
                  pinned={pinned}
                  active={active}
                  onSelect={onSelect}
                  onMenu={onPaneMenu}
                />
              );
            }
            return (
              <PaneRow
                key={`${group.bridgeId}:${pane.pane_id}`}
                index={index}
                pane={pane}
                workspaceLabel={rowContext.workspaceLabel}
                tabLabel={
                  agentGroup === "none" || agentGroup === "host" ? tabLabel : undefined
                }
                bridgeLabel={rowContext.bridgeLabel}
                pinned={pinned}
                active={active}
                onSelect={onSelect}
                onMenu={onPaneMenu}
              />
            );
          });
          if (agentGroup === "none") {
            return <Fragment key={`${group.bridgeId}:${tab.tab_id}`}>{paneRows}</Fragment>;
          }
          return (
            <div className="tabgrp" key={`${group.bridgeId}:${tab.tab_id}`}>
              {shouldShowTabDivider(agentGroup, group.workspace.tab_count, tabPanes.length) ? (
                <TabDivider
                  label={tabLabel}
                  count={tabPanes.length}
                  onSelect={() => onSelectTab(group.bridgeId, tab.tab_id)}
                  onMenu={(x, y) =>
                    onScopedMenu(
                      "tab",
                      group.bridgeId,
                      tab.tab_id,
                      tabLabel,
                      x,
                      y,
                      canClearTabName(tab),
                    )
                  }
                />
              ) : null}
              {paneRows}
            </div>
          );
        });
    return (
      <Fragment key={key}>
        {showWorkspaceHeader ? (
          <GroupHeader
            label={
              showBridgeInWorkspaceHeader
                ? `${group.bridgeLabel} / ${group.workspace.label}`
                : group.workspace.label
            }
            bridgeColor={showBridgeInWorkspaceHeader ? group.bridgeColor : undefined}
            status={group.workspace.agent_status}
            count={paneCount}
            collapsed={collapsed}
            nested={nestedHeader}
            onToggle={() => {
              if (collapseKey) {
                onToggleCollapsedGroup(collapseKey);
              }
            }}
          />
        ) : null}
        {tabRows}
      </Fragment>
    );
  };
  const renderTabGroups = () => {
    if (agentGroup === "host") {
      return hostBridgeViews.map((view) => {
        const entries = flatTabEntries.filter(
          (entry) => entry.bridgeId === view.runtime.id && entry.panes.length > 0,
        );
        if (entries.length === 0) {
          return null;
        }
        const collapseKey = sidebarGroupCollapseKey(
          "tabs",
          agentGroup,
          "host",
          view.runtime.id,
        );
        const collapsed = collapsedSidebarGroupKeys.has(collapseKey);
        return (
          <Fragment key={view.runtime.id}>
            <GroupHeader
              label={view.runtime.label}
              bridgeColor={view.runtime.color}
              status={aggregateStatus(entries.flatMap((entry) => entry.panes))}
              count={entries.reduce((total, entry) => total + entry.panes.length, 0)}
              collapsed={collapsed}
              onToggle={() => onToggleCollapsedGroup(collapseKey)}
            />
            {!collapsed
              ? entries.map((entry) =>
                  renderTabWorkspaceGroup(
                    {
                      ...entry,
                      tabs: [{ tab: entry.tab, panes: entry.panes }],
                    },
                    false,
                    false,
                    `${entry.bridgeId}:${entry.tab.tab_id}`,
                  ),
                )
              : null}
          </Fragment>
        );
      });
    }

    if (agentGroup === "hostWorkspace" && hostScope === "all") {
      return hostBridgeViews.map((view) => {
        const groups = spaceGroups.filter(
          (group) => group.bridgeId === view.runtime.id && group.tabs.length > 0,
        );
        if (groups.length === 0) {
          return null;
        }
        const collapseKey = sidebarGroupCollapseKey(
          "tabs",
          agentGroup,
          "host",
          view.runtime.id,
        );
        const collapsed = collapsedSidebarGroupKeys.has(collapseKey);
        return (
          <Fragment key={view.runtime.id}>
            <GroupHeader
              label={view.runtime.label}
              bridgeColor={view.runtime.color}
              status={aggregateStatus(
                groups.flatMap((group) => group.tabs.flatMap((tab) => tab.panes)),
              )}
              count={groups.reduce(
                (total, group) =>
                  total + group.tabs.reduce((subtotal, tab) => subtotal + tab.panes.length, 0),
                0,
              )}
              collapsed={collapsed}
              onToggle={() => onToggleCollapsedGroup(collapseKey)}
            />
            {!collapsed
              ? groups.map((group) =>
                  renderTabWorkspaceGroup(
                    group,
                    true,
                    false,
                    undefined,
                    sidebarGroupCollapseKey(
                      "tabs",
                      agentGroup,
                      "workspace",
                      `${group.bridgeId}:${group.workspace.workspace_id}`,
                    ),
                    true,
                  ),
                )
              : null}
          </Fragment>
        );
      });
    }

    if (agentGroup === "workspace") {
      if (combineWorkspaceGroups) {
        return combinedTabWorkspaceGroups.map((combinedGroup) => {
          const collapseKey = sidebarGroupCollapseKey(
            "tabs",
            agentGroup,
            "workspace",
            combinedGroup.key,
          );
          const collapsed = collapsedSidebarGroupKeys.has(collapseKey);
          const count = combinedGroup.workspaces.reduce(
            (total, group) =>
              total + group.tabs.reduce((subtotal, tab) => subtotal + tab.panes.length, 0),
            0,
          );
          return (
            <Fragment key={combinedGroup.key}>
              <GroupHeader
                label={combinedGroup.label}
                status={combinedGroup.status}
                count={count}
                collapsed={collapsed}
                onToggle={() => onToggleCollapsedGroup(collapseKey)}
              />
              {!collapsed
                ? combinedGroup.workspaces.map((group) =>
                    renderTabWorkspaceGroup(
                      group,
                      false,
                      false,
                      `${combinedGroup.key}:${group.bridgeId}:${group.workspace.workspace_id}`,
                    ),
                  )
                : null}
            </Fragment>
          );
        });
      }
      return spaceGroups.map((group) =>
        renderTabWorkspaceGroup(
          group,
          true,
          false,
          undefined,
          sidebarGroupCollapseKey(
            "tabs",
            agentGroup,
            "workspace",
            `${group.bridgeId}:${group.workspace.workspace_id}`,
          ),
        ),
      );
    }

    if (agentGroup === "hostWorkspace") {
      return spaceGroups.map((group) =>
        renderTabWorkspaceGroup(
          group,
          true,
          true,
          undefined,
          sidebarGroupCollapseKey(
            "tabs",
            agentGroup,
            "workspace",
            `${group.bridgeId}:${group.workspace.workspace_id}`,
          ),
        ),
      );
    }

    return flatTabEntries.map((entry) =>
      renderTabWorkspaceGroup(
        {
          ...entry,
          tabs: [{ tab: entry.tab, panes: entry.panes }],
        },
        false,
        showGroupedHostContext,
        `${entry.bridgeId}:${entry.tab.tab_id}`,
      ),
    );
  };
  const renderDisconnectedBridgeRows = () =>
    disconnectedBridgeViews.map((view) => (
      <DisconnectedBridgeRow
        key={view.runtime.id}
        label={view.runtime.label}
        message={
          view.runtime.capabilityError ||
          (view.loadState === "error" ? "Could not reach bridge" : "Bridge disconnected")
        }
        onSelect={() => {
          onSelectBridge(view.runtime.id);
          onHostScope("selected");
        }}
        onRetry={() => onRefreshBridge(view.runtime.id)}
      />
    ));
  const renderAgentRow = (entry: ScopedAgentPane, index: number) => {
    const rowContext = sidebarRowContext(
      agentGroup,
      hostScope,
      entry.bridgeLabel,
      entry.workspace?.label ?? "workspace",
    );
    return (
      <AgentRow
        key={`${entry.bridgeId}:${entry.pane.pane_id}`}
        index={index}
        pane={entry.pane}
        workspace={rowContext.workspaceLabel ? entry.workspace : undefined}
        tabLabel={entry.tabLabel}
        bridgeLabel={rowContext.bridgeLabel}
        pinned={entry.pinned === true}
        active={
          entry.bridgeId === selectedBridgeId &&
          entry.pane.pane_id === selectedPane?.pane_id
        }
        onSelect={() => onSelectPane(entry.bridgeId, entry.pane)}
        onMenu={(x, y) =>
          onScopedMenu(
            "pane",
            entry.bridgeId,
            entry.pane.pane_id,
            paneTitle(entry.pane),
            x,
            y,
            undefined,
            "agent",
          )
        }
      />
    );
  };
  const renderAgentGroupRows = () => {
    const renderGroup = (group: ScopedAgentGroup, nested = false) => {
      const level = agentGroup === "host" ? "host" : "workspace";
      const collapseKey = sidebarGroupCollapseKey(
        "agents",
        agentGroup,
        level,
        group.key,
      );
      const collapsed = collapsedSidebarGroupKeys.has(collapseKey);
      return (
        <Fragment key={group.key}>
          <GroupHeader
            label={group.label}
            bridgeColor={agentGroup === "host" ? group.bridgeColor : undefined}
            status={group.status}
            count={group.panes.length}
            collapsed={collapsed}
            nested={nested}
            onToggle={() => onToggleCollapsedGroup(collapseKey)}
          />
          {!collapsed
            ? group.panes.map((entry) => renderAgentRow(entry, agentPaneIndex++))
            : null}
        </Fragment>
      );
    };

    if (agentGroup !== "hostWorkspace" || hostScope !== "all") {
      return agentGroups.map((group) => renderGroup(group));
    }

    return hostBridgeViews.map((view) => {
      const groups = agentGroups.filter((group) => group.bridgeId === view.runtime.id);
      if (groups.length === 0) {
        return null;
      }
      const collapseKey = sidebarGroupCollapseKey(
        "agents",
        agentGroup,
        "host",
        view.runtime.id,
      );
      const collapsed = collapsedSidebarGroupKeys.has(collapseKey);
      return (
        <Fragment key={view.runtime.id}>
          <GroupHeader
            label={view.runtime.label}
            bridgeColor={view.runtime.color}
            status={aggregateStatus(
              groups.flatMap((group) => group.panes.map((entry) => entry.pane)),
            )}
            count={groups.reduce((total, group) => total + group.panes.length, 0)}
            collapsed={collapsed}
            onToggle={() => onToggleCollapsedGroup(collapseKey)}
          />
          {!collapsed ? groups.map((group) => renderGroup(group, true)) : null}
        </Fragment>
      );
    });
  };
  const renderNoteRows = () => {
    if (!notesSupported) {
      return (
        <div className="empty">
          <strong>Notes unavailable</strong>
          <span>Update the selected bridge to use pane notes.</span>
        </div>
      );
    }
    if (visibleNotes.length === 0) {
      return (
        <div className="empty">
          <strong>{notesLoading ? "Loading notes" : "No notes"}</strong>
          <span>{notesError || (notesLoading ? "" : "Create a note from the terminal header.")}</span>
        </div>
      );
    }
    return visibleNotes.map((entry, index) => (
      <NoteRow
        key={`${entry.bridgeId}:${entry.note.note_id}`}
        entry={entry}
        index={index}
        active={
          selectedNote?.bridgeId === entry.bridgeId &&
          selectedNote.note.note_id === entry.note.note_id
        }
        showBridge={hostScope === "all"}
        onSelect={() => onSelectNote(entry.bridgeId, entry.note.note_id)}
      />
    ));
  };
  const renderSpaceEntry = (
    entry: (typeof spaceEntries)[number],
    index: number,
    showBridgeLabel: boolean,
  ) => {
    const workspaceId = entry.workspace.workspace_id;
    const bridgeId = entry.view.runtime.id;
    const reorderMember =
      spaceReorderMode?.bridgeId === bridgeId && reorderBlockIdSet.has(workspaceId);
    const reorderSource = reorderMember && workspaceId === spaceReorderMode?.workspaceId;
    const dropBefore =
      spaceReorderMode?.bridgeId === bridgeId && spaceDragTarget === workspaceId;
    const dropAfter =
      spaceReorderMode?.bridgeId === bridgeId &&
      spaceDragTarget === null &&
      finalReorderWorkspaceId === workspaceId;
    return (
      <SpaceRow
      key={`${entry.view.runtime.id}:${entry.workspace.workspace_id}`}
      index={index}
      workspace={entry.workspace}
      bridgeLabel={showBridgeLabel ? entry.view.runtime.label : undefined}
      agentCount={entry.workspacePanes.filter(isAgentPane).length}
      active={entry.active}
      attention={countAttention(entry.workspacePanes)}
      reorderMember={reorderMember}
      reorderSource={reorderSource}
      reorderBusy={spaceReorderBusy}
      dropBefore={dropBefore}
      dropAfter={dropAfter}
      rowRef={(node) => setSpaceRowRef(bridgeId, workspaceId, node)}
      reorderCardRef={reorderSource ? spaceReorderCardRef : undefined}
      onSelect={() => {
        if (!spaceReorderMode) {
          onSelectSpace(bridgeId, workspaceId);
        }
      }}
      onMenu={(x, y) =>
        !spaceReorderMode
          ? onScopedMenu(
              "space",
              bridgeId,
              workspaceId,
              entry.workspace.label,
              x,
              y,
              canClearWorkspaceName(entry.workspace, entry.workspacePanes),
            )
          : undefined
      }
      onReorderPointerDown={beginSpaceDrag}
      onReorderPointerMove={updateSpaceDrag}
      onReorderPointerUp={(event) => finishSpaceDrag(event, true)}
      onReorderPointerCancel={(event) => finishSpaceDrag(event, false)}
      onReorderKeyDown={(event) => {
        const directions: Partial<Record<string, WorkspaceReorderDirection>> = {
          ArrowUp: "up",
          ArrowDown: "down",
          Home: "top",
          End: "bottom",
        };
        const direction = directions[event.key];
        if (direction) {
          event.preventDefault();
          moveSpaceWithKeyboard(direction);
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancelSpaceReorder();
        }
      }}
      onCancelReorder={cancelSpaceReorder}
    />
    );
  };

  return (
    <>
      {spaceReorderMode ? (
        <span id={SPACE_REORDER_INSTRUCTIONS_ID} className="sr-only">
          Use the Up and Down arrow keys to move this space one position, Home and End to move it
          to either end, and Escape to cancel.
        </span>
      ) : null}
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
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          onClick={(event) => {
            focusOverlayTrigger(event.currentTarget);
            onToggleTheme();
          }}
        >
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button
          className="icon-btn"
          type="button"
          aria-label="Settings"
          title={`Settings; bridge: ${bridgeLabel}`}
          data-spin={capabilityState === "probing" ? "" : undefined}
          onClick={(event) => {
            focusOverlayTrigger(event.currentTarget);
            onBackendSettings();
          }}
        >
          <Settings size={16} />
        </button>
        <button
          className="icon-btn"
          type="button"
          aria-label="Refresh"
          title="Refresh"
          data-spin={loadState === "loading" ? "" : undefined}
          onClick={(event) => {
            focusOverlayTrigger(event.currentTarget);
            onRefresh();
          }}
        >
          <RefreshCw size={16} />
        </button>
      </header>

      <div className="sidebar-scope host-scope" role="group" aria-label="Host">
        {bridgeViews.map((view) => (
          <button
            key={view.runtime.id}
            className="bridge-chip"
            type="button"
            style={{ "--bridge-color": view.runtime.color } as CSSProperties}
            data-on={hostScope === "selected" && selectedBridgeId === view.runtime.id}
            aria-pressed={hostScope === "selected" && selectedBridgeId === view.runtime.id}
            onClick={() => {
              onSelectBridge(view.runtime.id);
              onHostScope("selected");
            }}
          >
            <span className="bridge-chip-dot" aria-hidden="true" />
            <span className="bridge-chip-label">{view.runtime.label}</span>
          </button>
        ))}
        {bridgeViews.length > 1 ? (
          <button
            className="bridge-chip"
            type="button"
            data-on={hostScope === "all"}
            aria-pressed={hostScope === "all"}
            onClick={() => onHostScope("all")}
          >
            <span className="bridge-chip-label">All</span>
          </button>
        ) : null}
      </div>

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
        {notesEnabled ? (
          <button
            type="button"
            data-on={sidebarView === "notes"}
            aria-pressed={sidebarView === "notes"}
            onClick={() => onSidebarView("notes")}
          >
            Notes
          </button>
        ) : null}
      </div>
      <div className="sidebar-scope" role="group" aria-label="Sidebar scope">
        <button
          type="button"
          data-on={scope === "space"}
          aria-pressed={scope === "space"}
          onClick={() => onScope("space")}
        >
          Space
        </button>
        <button
          type="button"
          data-on={scope === "all"}
          aria-pressed={scope === "all"}
          onClick={() => onScope("all")}
        >
          All
        </button>
      </div>

      <div className="list" ref={spaceListRef}>
        {!hasListSnapshot ? (
          <div className="empty">
            <strong>
              {bridgeViews.length === 0
                ? "No bridges enabled"
                : bridgeBlocked
                ? "Bridge disconnected"
                : loadState === "error"
                  ? "Bridge unavailable"
                  : "Connecting…"}
            </strong>
            <span>
              {bridgeViews.length === 0
                ? "Enable one or more bridges in settings."
                : bridgeBlocked
                ? bridgeError || "Choose a usable bridge backend."
                : loadState === "error"
                  ? "Could not reach the herdr bridge."
                  : ""}
            </span>
            {bridgeBlocked ? (
              <button
                type="button"
                className="btn"
                onClick={(event) => {
                  focusOverlayTrigger(event.currentTarget);
                  onBackendSettings();
                }}
              >
                Settings
              </button>
            ) : null}
          </div>
        ) : (
          <>
            {/* SPACES ---------------------------------------------------- */}
            {scope === "space" && hostBridgeViews.some((view) => view.snapshot) ? (
            <section className="sec" data-sidebar-section="spaces">
              <div className="sec-head">
                <span className="sec-label">spaces</span>
                <span className="sec-rule" />
                <span className="sec-count mono">{spaceCount}</span>
                {hostScope === "selected" ? (
                  <button
                    className="sec-add"
                    type="button"
                    aria-label="New space"
                    title="New space"
                    onClick={onCreateSpace}
                  >
                    <Plus size={14} />
                  </button>
                ) : null}
                {canGroupSpacesByHost ? (
                  <button
                    className="sec-add"
                    type="button"
                    aria-label="Space list options"
                    title="Space list options"
                    aria-haspopup="dialog"
                    aria-expanded={spaceOptionsMenu ? "true" : "false"}
                    onClick={(event) => {
                      focusOverlayTrigger(event.currentTarget);
                      const rect = event.currentTarget.getBoundingClientRect();
                      setOptionsMenu(null);
                      setSpaceOptionsMenu({ x: rect.right, y: rect.bottom + 4 });
                    }}
                  >
                    <MoreVertical size={14} />
                  </button>
                ) : null}
              </div>
              {spaceCount === 0 ? (
                <div className="empty">
                  <strong>No spaces yet</strong>
                  <span>{hostScope === "selected" ? "Tap + to create one." : "No enabled host has spaces."}</span>
                </div>
              ) : effectiveSpaceGroup === "host" ? (
                hostBridgeViews.map((view) => {
                  const entries = spaceEntries.filter(
                    (entry) => entry.view.runtime.id === view.runtime.id,
                  );
                  if (entries.length === 0) {
                    return null;
                  }
                  const collapseKey = sidebarGroupCollapseKey(
                    "spaces",
                    effectiveSpaceGroup,
                    "host",
                    view.runtime.id,
                  );
                  const collapsed = collapsedSidebarGroupKeys.has(collapseKey);
                  return (
                    <Fragment key={view.runtime.id}>
                      <GroupHeader
                        label={view.runtime.label}
                        bridgeColor={view.runtime.color}
                        status={aggregateStatus(entries.flatMap((entry) => entry.workspacePanes))}
                        count={entries.length}
                        collapsed={collapsed}
                        onToggle={() => onToggleCollapsedGroup(collapseKey)}
                      />
                      {!collapsed
                        ? entries.map((entry, index) => renderSpaceEntry(entry, index, false))
                        : null}
                    </Fragment>
                  );
                })
              ) : (
                spaceEntries.map((entry, index) =>
                  renderSpaceEntry(entry, index, canGroupSpacesByHost),
                )
              )}
            </section>
            ) : null}

            {/* PANES ----------------------------------------------------- */}
            {notesViewActive ||
            (hostScope === "all" ? hasListSnapshot : snapshot && snapshot.workspaces.length > 0) ? (
            <section className="sec" data-sidebar-section="content">
              <div className="sec-head">
                <span className="sec-label">
                  {sidebarView === "agents"
                    ? scope === "all"
                      ? "all agents"
                      : "space agents"
                    : notesViewActive
                      ? scope === "all"
                        ? "all notes"
                        : "space notes"
                    : scope === "all"
                      ? "all tabs"
                      : hostScope === "all"
                        ? "space tabs"
                        : (activeSpace?.label ?? "tabs")}
                </span>
                <span className="sec-rule" />
                {canCreateTabFromHeader ? (
                  <button
                    className="sec-add"
                    type="button"
                    aria-label="New tab"
                    title="New tab"
                    onClick={(event) => {
                      focusOverlayTrigger(event.currentTarget);
                      if (selectedBridgeId && activeSpace) {
                        onCreateTab(selectedBridgeId, activeSpace.workspace_id);
                      }
                    }}
                  >
                    <Plus size={14} />
                  </button>
                ) : null}
                {canCreateNoteFromHeader ? (
                  <button
                    className="sec-add"
                    type="button"
                    aria-label="New note"
                    title="New note"
                    onClick={onCreateNote}
                  >
                    <Plus size={14} />
                  </button>
                ) : null}
                {showPinnedOnlyControl ? (
                  <button
                    className="sec-add"
                    type="button"
                    aria-label={`Show ${pinnedOnlyLabel} only`}
                    title="Pinned only"
                    aria-pressed={agentPinnedOnly}
                    data-on={agentPinnedOnly}
                    onClick={() => onAgentPinnedOnly(!agentPinnedOnly)}
                  >
                    <Pin size={13} />
                  </button>
                ) : null}
                {showActiveOnlyControl ? (
                  <button
                    className="sec-add"
                    type="button"
                    aria-label={`Show active ${sidebarView === "tabs" ? "agents" : "statuses"} only`}
                    title={sidebarView === "tabs" ? "Active agents only" : "Active statuses only"}
                    aria-pressed={agentActiveOnly}
                    data-on={agentActiveOnly}
                    onClick={() => onAgentActiveOnly(!agentActiveOnly)}
                  >
                    <Activity size={13} />
                  </button>
                ) : null}
                {paneGroupCollapseKeys.length > 0 ? (
                  <button
                    className="sec-add"
                    type="button"
                    aria-label={
                      allPaneGroupsCollapsed ? "Expand all groups" : "Collapse all groups"
                    }
                    title={allPaneGroupsCollapsed ? "Expand all groups" : "Collapse all groups"}
                    onClick={() =>
                      onSetCollapsedGroups(paneGroupCollapseKeys, !allPaneGroupsCollapsed)
                    }
                  >
                    {allPaneGroupsCollapsed ? (
                      <ListRestart size={14} />
                    ) : (
                      <ListCollapse size={14} />
                    )}
                  </button>
                ) : null}
                {showOptionsControl ? (
                  <button
                    className="sec-add"
                    type="button"
                    aria-label={`${sidebarView === "agents" ? "Agent" : "Tab"} list options`}
                    title={`${sidebarView === "agents" ? "Agent" : "Tab"} list options`}
                    aria-haspopup="dialog"
                    aria-expanded={optionsMenu ? "true" : "false"}
                    onClick={(event) => {
                      focusOverlayTrigger(event.currentTarget);
                      const rect = event.currentTarget.getBoundingClientRect();
                      setSpaceOptionsMenu(null);
                      setOptionsMenu({ x: rect.right, y: rect.bottom + 4 });
                    }}
                  >
                    <MoreVertical size={14} />
                  </button>
                ) : null}
              </div>

              {notesViewActive ? (
                renderNoteRows()
              ) : sidebarView === "agents" ? (
                <>
                  {agentPanes.length > 0 ? (
                    <div className="agent-search-row">
                      <input
                        className="agent-search-input"
                        type="search"
                        placeholder="Filter agents…"
                        value={agentSearch}
                        aria-label="Filter agents"
                        spellCheck={false}
                        autoComplete="off"
                        onChange={(event) => setAgentSearch(event.currentTarget.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            setAgentSearch("");
                          }
                        }}
                      />
                    </div>
                  ) : null}
                  {filteredAgentPanes.length === 0 && disconnectedBridgeViews.length === 0 ? (
                    <div className="empty">
                      <strong>
                        {agentSearchTrimmed
                          ? "No matches"
                          : emptyAgentListTitle(effectiveAgentPinnedOnly, agentActiveOnly)}
                      </strong>
                      <span>
                        {agentSearchTrimmed
                          ? `No agents match "${agentSearch.trim()}".`
                          : effectiveAgentPinnedOnly || agentActiveOnly
                            ? ""
                            : "Open the Tabs view for plain panes."}
                      </span>
                      {agentSearchTrimmed ? (
                        <button
                          type="button"
                          className="btn"
                          onClick={() => setAgentSearch("")}
                        >
                          Clear filter
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <>
                      {renderDisconnectedBridgeRows()}
                      {agentGroup !== "none"
                        ? renderAgentGroupRows()
                        : filteredAgentPanes.map((entry, index) => renderAgentRow(entry, index))}
                    </>
                  )}
                </>
              ) : spaceGroups.every((group) => group.tabs.length === 0) ? (
                disconnectedBridgeViews.length > 0 ? (
                  <>{renderDisconnectedBridgeRows()}</>
                ) : (
                <div className="empty">
                  <strong>
                    {agentFeaturesInTabs && agentActiveOnly
                      ? emptyAgentListTitle(effectiveAgentPinnedOnly, true)
                      : effectiveAgentPinnedOnly
                        ? "No pinned panes"
                        : "No panes"}
                  </strong>
                  <span>
                    {effectiveAgentPinnedOnly || (agentFeaturesInTabs && agentActiveOnly)
                      ? ""
                      : scope === "space"
                        ? "This space has no panes yet."
                        : "No workspace has panes yet."}
                  </span>
                </div>
                )
              ) : (
                renderTabGroups()
              )}
            </section>
            ) : null}
          </>
        )}
      </div>
      {optionsMenu ? (
        <SidebarOptionsMenu
          x={optionsMenu.x}
          y={optionsMenu.y}
          sidebarView={sidebarView}
          showSort={shouldShowSidebarSort(sidebarView, agentFeaturesInTabs)}
          showGroup={showGroupControl}
          agentSort={agentSort}
          agentGroup={agentGroup}
          showLastStatusChangeSort={showLastStatusChangeSort}
          onAgentSort={onAgentSort}
          onAgentGroup={onAgentGroup}
          onClose={() => setOptionsMenu(null)}
        />
      ) : null}
      {spaceOptionsMenu ? (
        <SpaceOptionsMenu
          x={spaceOptionsMenu.x}
          y={spaceOptionsMenu.y}
          spaceGroup={spaceGroup}
          onSpaceGroup={onSpaceGroup}
          onClose={() => setSpaceOptionsMenu(null)}
        />
      ) : null}
    </>
  );
}

function SidebarOptionsMenu({
  x,
  y,
  sidebarView,
  showSort,
  showGroup,
  agentSort,
  agentGroup,
  showLastStatusChangeSort,
  onAgentSort,
  onAgentGroup,
  onClose,
}: {
  x: number;
  y: number;
  sidebarView: SidebarView;
  showSort: boolean;
  showGroup: boolean;
  agentSort: AgentSort;
  agentGroup: AgentGroup;
  showLastStatusChangeSort: boolean;
  onAgentSort: (sort: AgentSort) => void;
  onAgentGroup: (group: AgentGroup) => void;
  onClose: () => void;
}) {
  return (
    <OptionsMenuShell
      x={x}
      y={y}
      ariaLabel={`${sidebarView === "agents" ? "Agent" : "Tab"} list options`}
      onClose={onClose}
    >
      {showSort ? (
        <label className="sidebar-option-field">
          <span>Sort</span>
          <select
            value={agentSort}
            onChange={(event) => onAgentSort(event.currentTarget.value as AgentSort)}
          >
            <option value="attention">Attention</option>
            <option value="status">Status</option>
            {showLastStatusChangeSort ? (
              <option value="lastStatusChange">Last status change</option>
            ) : null}
            <option value="workspace">Workspace</option>
          </select>
        </label>
      ) : null}
      {showGroup ? (
        <label className="sidebar-option-field">
          <span>Group</span>
          <select
            value={agentGroup}
            onChange={(event) => onAgentGroup(event.currentTarget.value as AgentGroup)}
          >
            <option value="none">None</option>
            <option value="host">Host</option>
            <option value="workspace">Workspace</option>
            <option value="hostWorkspace">Host + workspace</option>
          </select>
        </label>
      ) : null}
    </OptionsMenuShell>
  );
}

function SpaceOptionsMenu({
  x,
  y,
  spaceGroup,
  onSpaceGroup,
  onClose,
}: {
  x: number;
  y: number;
  spaceGroup: SpaceGroup;
  onSpaceGroup: (group: SpaceGroup) => void;
  onClose: () => void;
}) {
  return (
    <OptionsMenuShell x={x} y={y} ariaLabel="Space list options" onClose={onClose}>
      <label className="sidebar-option-field">
        <span>Group</span>
        <select
          value={spaceGroup}
          onChange={(event) => onSpaceGroup(event.currentTarget.value as SpaceGroup)}
        >
          <option value="none">None</option>
          <option value="host">Host</option>
        </select>
      </label>
    </OptionsMenuShell>
  );
}

function OptionsMenuShell({
  x,
  y,
  ariaLabel,
  onClose,
  children,
}: {
  x: number;
  y: number;
  ariaLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useFocusReturn();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const margin = 8;
    let left = x - rect.width;
    let top = y;
    if (left < margin) {
      left = margin;
    }
    if (top + rect.height > window.innerHeight - margin) {
      top = window.innerHeight - margin - rect.height;
    }
    setPos({ left, top: Math.max(margin, top) });
  }, [x, y]);

  useLayoutEffect(() => {
    if (!pos || !ref.current) {
      return;
    }
    (focusableElements(ref.current)[0] ?? ref.current).focus();
  }, [pos]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    const removeNativeBackHandler = addNativeBackHandler(() => {
      onClose();
      return true;
    });
    return () => {
      window.removeEventListener("keydown", onKey);
      removeNativeBackHandler();
    };
  }, [onClose]);

  return (
    <div className="overlay-root">
      <button
        className="overlay-scrim overlay-scrim-clear"
        type="button"
        tabIndex={-1}
        aria-label="Close list options"
        onClick={onClose}
      />
      <div
        ref={ref}
        className="sidebar-options-menu"
        role="dialog"
        aria-label={ariaLabel}
        tabIndex={-1}
        onKeyDown={trapFocusWithin}
        style={{
          left: pos?.left ?? x,
          top: pos?.top ?? y,
          visibility: pos ? "visible" : "hidden",
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function QuickPaneNoteDialog({
  targetLabel,
  busy,
  onCancel,
  onSubmit,
}: {
  targetLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onSubmit: (title: string, body: string) => void;
}) {
  const [title, setTitle] = useState("Untitled note");
  const [bodyExpanded, setBodyExpanded] = useState(false);
  const [body, setBody] = useState("");
  const dialogRef = useRef<HTMLFormElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const bodyInputRef = useRef<HTMLTextAreaElement | null>(null);
  useFocusReturn();

  useEffect(() => {
    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, []);

  useEffect(() => {
    if (bodyExpanded) {
      bodyInputRef.current?.focus();
    }
  }, [bodyExpanded]);

  useEffect(() => {
    return addNativeBackHandler(() => {
      if (!busy) {
        onCancel();
      }
      return true;
    });
  }, [busy, onCancel]);

  const cancel = () => {
    if (!busy) {
      onCancel();
    }
  };

  const submit = (event: ReactFormEvent) => {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle || busy) {
      return;
    }
    onSubmit(trimmedTitle, bodyExpanded ? body : "");
  };
  return (
    <div className="overlay-root">
      <button
        className="overlay-scrim"
        type="button"
        tabIndex={-1}
        aria-label="Cancel"
        disabled={busy}
        onClick={cancel}
      />
      <form
        ref={dialogRef}
        className="modal quick-note-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Add note"
        onSubmit={submit}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            cancel();
            return;
          }
          trapFocusWithin(event);
        }}
      >
        <div className="modal-title">Add note</div>
        <div className="modal-message quick-note-target">Attached to {targetLabel}</div>
        <label className="field-label">
          <span>Title</span>
          <input
            ref={titleInputRef}
            className="field"
            value={title}
            placeholder="Untitled note"
            spellCheck={false}
            autoComplete="off"
            disabled={busy}
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
        </label>
        {bodyExpanded ? (
          <label className="field-label">
            <span>Body</span>
            <textarea
              ref={bodyInputRef}
              className="field quick-note-body"
              value={body}
              placeholder="Write a note"
              disabled={busy}
              rows={5}
              onChange={(event) => setBody(event.currentTarget.value)}
            />
          </label>
        ) : (
          <button
            className="btn quick-note-expand"
            type="button"
            disabled={busy}
            aria-expanded="false"
            onClick={() => setBodyExpanded(true)}
          >
            Add body
          </button>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" disabled={busy} onClick={cancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !title.trim()}>
            Create
          </button>
        </div>
      </form>
    </div>
  );
}

function NotesSurface({
  compact,
  mobileScreen,
  selectedEntry,
  selectedBridgeId,
  titleFocusRequest,
  onTitleFocusRequestHandled,
  selectedPane,
  selectedPaneNotes,
  visibleNotes,
  notesLoadState,
  notesError,
  includeArchived,
  includeDeleted,
  currentBridgeSupportsNotes,
  canAttachToCurrentPane,
  onClose,
  onShowNotesList,
  onSelectNote,
  onCreatePaneNote,
  onCreateDetachedNote,
  onIncludeArchived,
  onIncludeDeleted,
  onSaveNote,
  onAttachToCurrentPane,
  onDetach,
  onArchive,
  onRestore,
  onDelete,
  onViewPane,
  width,
  listWidth,
  listCollapsed,
  onListCollapsed,
  onResizeStart,
  onResizeKeyDown,
  onListResizeStart,
  onListResizeKeyDown,
}: {
  compact: boolean;
  mobileScreen: MobileNotesScreen;
  selectedEntry: ScopedNoteEntry | null;
  selectedBridgeId: BridgeId | null;
  titleFocusRequest: ScopedNoteTitleFocusRequest | null;
  onTitleFocusRequestHandled: (request: ScopedNoteTitleFocusRequest) => void;
  selectedPane: PaneInfo | null;
  selectedPaneNotes: ScopedNoteEntry[];
  visibleNotes: ScopedNoteEntry[];
  notesLoadState: LoadState;
  notesError: string | null;
  includeArchived: boolean;
  includeDeleted: boolean;
  currentBridgeSupportsNotes: boolean;
  canAttachToCurrentPane: boolean;
  onClose: () => void;
  onShowNotesList: () => void;
  onSelectNote: (bridgeId: BridgeId, noteId: string) => void;
  onCreatePaneNote: () => void;
  onCreateDetachedNote: () => void;
  onIncludeArchived: (include: boolean) => void;
  onIncludeDeleted: (include: boolean) => void;
  onSaveNote: (
    entry: ScopedNoteEntry,
    title: string,
    body: string,
    expectedRevision: number,
  ) => Promise<number>;
  onAttachToCurrentPane: (entry: ScopedNoteEntry) => void;
  onDetach: (entry: ScopedNoteEntry) => void;
  onArchive: (entry: ScopedNoteEntry) => void;
  onRestore: (entry: ScopedNoteEntry) => void;
  onDelete: (entry: ScopedNoteEntry) => void;
  onViewPane: (entry: ScopedNoteEntry) => void;
  width: number;
  listWidth: number;
  listCollapsed: boolean;
  onListCollapsed: (collapsed: boolean) => void;
  onResizeStart: (clientX: number) => void;
  onResizeKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onListResizeStart: (surfaceLeft: number, clientX: number) => void;
  onListResizeKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
}) {
  const effectiveListCollapsed = !compact && listCollapsed;
  const otherNotes = useMemo(
    () =>
      visibleNotes.filter(
        (entry) => !scopedNoteLinkedToPane(entry, selectedBridgeId, selectedPane?.pane_id),
      ),
    [selectedBridgeId, selectedPane?.pane_id, visibleNotes],
  );
  const showPaneNoteTabs = Boolean(selectedPane && !(compact && mobileScreen === "editor"));

  return (
    <aside
      className="notes-surface"
      data-compact={compact ? "true" : "false"}
      data-mobile-screen={mobileScreen}
      data-list={effectiveListCollapsed ? "collapsed" : "open"}
      role={compact ? "dialog" : "complementary"}
      aria-label="Notes"
    >
      <div
        className="notes-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize notes"
        aria-valuemin={MIN_NOTES_PANEL_WIDTH}
        aria-valuemax={MAX_NOTES_PANEL_WIDTH}
        aria-valuenow={width}
        tabIndex={compact ? -1 : 0}
        onPointerDown={(event) => {
          if (compact) {
            return;
          }
          event.preventDefault();
          onResizeStart(event.clientX);
        }}
        onKeyDown={onResizeKeyDown}
      />
      <header className="notes-head">
        {!compact ? (
          <button
            className="icon-btn"
            type="button"
            aria-label={effectiveListCollapsed ? "Show notes list" : "Hide notes list"}
            title={effectiveListCollapsed ? "Show notes list" : "Hide notes list"}
            aria-pressed={!effectiveListCollapsed}
            onClick={() => onListCollapsed(!effectiveListCollapsed)}
          >
            <PanelLeft size={18} />
          </button>
        ) : null}
        {compact && mobileScreen === "editor" ? (
          <button
            className="icon-btn"
            type="button"
            aria-label="Show notes list"
            title="Show notes list"
            onClick={onShowNotesList}
          >
            <PanelLeft size={18} />
          </button>
        ) : null}
        <div>
          <span className="notes-title">Notes</span>
          <span className="notes-sub mono">
            {selectedPane ? paneTitle(selectedPane) : "All notes"}
          </span>
        </div>
        <button className="icon-btn" type="button" aria-label="Close notes" title="Close" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      {showPaneNoteTabs ? (
        <div className="pane-note-tabs" role="tablist" aria-label="Pane notes">
          {selectedPaneNotes.map((entry) => (
            <button
              key={`${entry.bridgeId}:${entry.note.note_id}`}
              className="pane-note-tab"
              type="button"
              role="tab"
              aria-selected={
                selectedEntry?.bridgeId === entry.bridgeId &&
                selectedEntry.note.note_id === entry.note.note_id
              }
              data-active={
                selectedEntry?.bridgeId === entry.bridgeId &&
                selectedEntry.note.note_id === entry.note.note_id
                  ? "true"
                  : "false"
              }
              onClick={() => onSelectNote(entry.bridgeId, entry.note.note_id)}
            >
              {entry.note.title || "Untitled note"}
            </button>
          ))}
          <button
            className="pane-note-tab pane-note-tab-new"
            type="button"
            aria-label="New pane note"
            title="New pane note"
            disabled={!currentBridgeSupportsNotes}
            onClick={onCreatePaneNote}
          >
            <Plus size={15} />
          </button>
        </div>
      ) : null}
      <div className="notes-shell">
        <div className="notes-list-pane">
          <section className="notes-section">
            <div className="notes-section-head">
              <span>Other</span>
              <label className="notes-filter">
                <input
                  type="checkbox"
                  checked={includeArchived}
                  onChange={(event) => onIncludeArchived(event.currentTarget.checked)}
                />
                Archived
              </label>
              <label className="notes-filter">
                <input
                  type="checkbox"
                  checked={includeDeleted}
                  onChange={(event) => onIncludeDeleted(event.currentTarget.checked)}
                />
                Deleted
              </label>
              <button
                className="icon-btn"
                type="button"
                aria-label="New detached note"
                title="New detached note"
                disabled={!currentBridgeSupportsNotes}
                onClick={onCreateDetachedNote}
              >
                <Plus size={15} />
              </button>
            </div>
            {notesLoadState === "loading" && otherNotes.length === 0 ? (
              <div className="notes-empty">Loading notes</div>
            ) : notesError && otherNotes.length === 0 ? (
              <div className="notes-empty">{notesError}</div>
            ) : otherNotes.length === 0 ? (
              <div className="notes-empty">No other notes</div>
            ) : (
              otherNotes.map((entry) => (
                <NotesListItem
                  key={`${entry.bridgeId}:${entry.note.note_id}`}
                  entry={entry}
                  active={
                    selectedEntry?.bridgeId === entry.bridgeId &&
                    selectedEntry.note.note_id === entry.note.note_id
                  }
                  onSelect={() => onSelectNote(entry.bridgeId, entry.note.note_id)}
                />
              ))
            )}
          </section>
          <div
            className="notes-list-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize notes list"
            aria-valuemin={MIN_NOTES_LIST_PANE_WIDTH}
            aria-valuemax={MAX_NOTES_LIST_PANE_WIDTH}
            aria-valuenow={listWidth}
            tabIndex={effectiveListCollapsed ? -1 : 0}
            onPointerDown={(event) => {
              if (effectiveListCollapsed) {
                return;
              }
              const surface = event.currentTarget.closest(".notes-surface");
              if (!(surface instanceof HTMLElement)) {
                return;
              }
              event.preventDefault();
              onListResizeStart(surface.getBoundingClientRect().left, event.clientX);
            }}
            onKeyDown={onListResizeKeyDown}
          />
        </div>
        <NoteEditor
          entry={selectedEntry}
          currentBridgeId={selectedBridgeId}
          currentPaneId={selectedPane?.pane_id ?? null}
          titleFocusRequest={titleFocusRequest}
          onTitleFocusRequestHandled={onTitleFocusRequestHandled}
          canAttachToCurrentPane={canAttachToCurrentPane}
          showCurrentPaneViewAction={compact}
          onSave={onSaveNote}
          onAttachToCurrentPane={onAttachToCurrentPane}
          onDetach={onDetach}
          onArchive={onArchive}
          onRestore={onRestore}
          onDelete={onDelete}
          onViewPane={onViewPane}
        />
      </div>
    </aside>
  );
}

function NotesListItem({
  entry,
  active,
  onSelect,
}: {
  entry: ScopedNoteEntry;
  active: boolean;
  onSelect: () => void;
}) {
  const state = noteStateLabel(entry.note);
  return (
    <button className="notes-list-item" type="button" data-active={active} onClick={onSelect}>
      <span
        className="bridge-chip-dot"
        style={{ "--bridge-color": entry.bridgeColor } as CSSProperties}
        aria-hidden="true"
      />
      <span className="notes-list-item-body">
        <span className="notes-list-item-title">{entry.note.title || "Untitled note"}</span>
        <span className="notes-list-item-sub mono">{noteSubtitle(entry, true)}</span>
      </span>
      <NoteStateIcon note={entry.note} label={state.label} status={state.status} />
    </button>
  );
}

export function NoteEditor({
  entry,
  currentBridgeId,
  currentPaneId,
  titleFocusRequest = null,
  onTitleFocusRequestHandled,
  canAttachToCurrentPane,
  showCurrentPaneViewAction = false,
  onSave,
  onAttachToCurrentPane,
  onDetach,
  onArchive,
  onRestore,
  onDelete,
  onViewPane,
}: {
  entry: ScopedNoteEntry | null;
  currentBridgeId: BridgeId | null;
  currentPaneId: string | null;
  titleFocusRequest?: ScopedNoteTitleFocusRequest | null;
  onTitleFocusRequestHandled?: (request: ScopedNoteTitleFocusRequest) => void;
  canAttachToCurrentPane: boolean;
  showCurrentPaneViewAction?: boolean;
  onSave: (
    entry: ScopedNoteEntry,
    title: string,
    body: string,
    expectedRevision: number,
  ) => Promise<number>;
  onAttachToCurrentPane: (entry: ScopedNoteEntry) => void;
  onDetach: (entry: ScopedNoteEntry) => void;
  onArchive: (entry: ScopedNoteEntry) => void;
  onRestore: (entry: ScopedNoteEntry) => void;
  onDelete: (entry: ScopedNoteEntry) => void;
  onViewPane: (entry: ScopedNoteEntry) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [dirty, setDirty] = useState(false);
  const [baseRevision, setBaseRevision] = useState<number | null>(null);
  const [editorNoteIdentity, setEditorNoteIdentity] = useState("");
  const [saveRetryCycle, setSaveRetryCycle] = useState(0);
  const [saveState, setSaveState] = useState<
    "idle" | "pending" | "saving" | "saved" | "error" | "conflict"
  >("idle");
  const [editorMode, setEditorModeState] = useState<NoteEditorMode>(() => readNoteEditorMode());
  const loadedNoteIdentityRef = useRef("");
  const saveBlockedRef = useRef(false);
  const noteSaveInFlightRef = useRef<NoteSaveInFlight | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const entryRef = useRef(entry);
  const onSaveRef = useRef(onSave);
  const noteIdentity = entry ? noteDraftStorageKey(entry) : "";
  const noteKey = entry ? `${entry.bridgeId}:${entry.note.note_id}:${entry.note.revision}` : "";
  const currentEntryBridgeId = entry?.bridgeId ?? null;
  const currentEntryNoteId = entry?.note.note_id ?? null;
  const serverTitle = entry?.note.title ?? "";
  const serverBody = entry?.note.body ?? "";
  const serverRevision = entry?.note.revision ?? 0;

  useEffect(() => {
    entryRef.current = entry;
  }, [entry]);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  const setEditorMode = useCallback((mode: NoteEditorMode) => {
    setEditorModeState(mode);
    writeNoteEditorMode(mode);
  }, []);

  useEffect(() => {
    if (!entry) {
      loadedNoteIdentityRef.current = "";
      setEditorNoteIdentity("");
      setTitle("");
      setBody("");
      setDirty(false);
      setBaseRevision(null);
      setSaveState("idle");
      saveBlockedRef.current = false;
      noteSaveInFlightRef.current = null;
      return;
    }
    const noteChanged = loadedNoteIdentityRef.current !== noteIdentity;
    if (!noteChanged && dirty && title === entry.note.title && body === entry.note.body) {
      setDirty(false);
      setBaseRevision(entry.note.revision);
      setSaveState("saved");
      saveBlockedRef.current = false;
      clearNoteDraft(entry);
      return;
    }
    const expectedRevision = baseRevision ?? entry.note.revision;
    if (
      !noteChanged &&
      isInFlightNoteSaveVisible({
        inFlight: noteSaveInFlightRef.current,
        noteIdentity,
        serverRevision: entry.note.revision,
        serverTitle: entry.note.title,
        serverBody: entry.note.body,
      })
    ) {
      setBaseRevision((current) =>
        current === null || current < entry.note.revision ? entry.note.revision : current,
      );
      saveBlockedRef.current = false;
      setSaveState("pending");
      return;
    }
    if (
      !noteChanged &&
      shouldBlockDirtyNoteAutosave({
        dirty,
        title,
        body,
        baseRevision: expectedRevision,
        serverTitle: entry.note.title,
        serverBody: entry.note.body,
        serverRevision: entry.note.revision,
      })
    ) {
      saveBlockedRef.current = true;
      setSaveState("conflict");
      writeNoteDraft(entry, title, body, expectedRevision);
      return;
    }
    if (noteChanged) {
      const draft = readNoteDraft(entry);
      loadedNoteIdentityRef.current = noteIdentity;
      setEditorNoteIdentity(noteIdentity);
      if (draft && (draft.title !== entry.note.title || draft.body !== entry.note.body)) {
        const hasConflict = draft.baseRevision !== entry.note.revision;
        setTitle(draft.title);
        setBody(draft.body);
        setDirty(true);
        setBaseRevision(draft.baseRevision);
        setSaveState(hasConflict ? "conflict" : "pending");
        saveBlockedRef.current = hasConflict;
      } else {
        setTitle(entry.note.title);
        setBody(entry.note.body);
        setDirty(false);
        setBaseRevision(entry.note.revision);
        setSaveState("idle");
        saveBlockedRef.current = false;
        clearNoteDraft(entry);
      }
      return;
    }
    if (!dirty) {
      setTitle(entry.note.title);
      setBody(entry.note.body);
      setBaseRevision(entry.note.revision);
      setSaveState("idle");
      saveBlockedRef.current = false;
      clearNoteDraft(entry);
    }
  }, [baseRevision, body, dirty, entry, noteIdentity, noteKey, title]);

  useEffect(() => {
    if (
      !currentEntryBridgeId ||
      !currentEntryNoteId ||
      !titleFocusRequest ||
      titleFocusRequest.bridgeId !== currentEntryBridgeId ||
      titleFocusRequest.noteId !== currentEntryNoteId
    ) {
      return;
    }
    setEditorMode("edit");
    const handledRequest = titleFocusRequest;
    const focusTimer = window.setTimeout(() => {
      const titleInput = titleInputRef.current;
      if (!titleInput || titleInput.disabled) {
        onTitleFocusRequestHandled?.(handledRequest);
        return;
      }
      titleInput.focus();
      titleInput.select();
      onTitleFocusRequestHandled?.(handledRequest);
    }, 0);
    return () => window.clearTimeout(focusTimer);
  }, [
    currentEntryBridgeId,
    currentEntryNoteId,
    onTitleFocusRequestHandled,
    setEditorMode,
    titleFocusRequest,
  ]);

  useEffect(() => {
    if (!entry) {
      return;
    }
    if (dirty && (title !== entry.note.title || body !== entry.note.body)) {
      writeNoteDraft(entry, title, body, baseRevision ?? entry.note.revision);
    } else {
      clearNoteDraft(entry);
    }
  }, [baseRevision, body, dirty, entry, title]);

  useEffect(() => {
    if (!noteIdentity || !dirty) {
      return;
    }
    if (editorNoteIdentity !== noteIdentity) {
      return;
    }
    if (title === serverTitle && body === serverBody) {
      return;
    }
    const currentEntry = entryRef.current;
    if (!currentEntry || noteDraftStorageKey(currentEntry) !== noteIdentity) {
      return;
    }
    const expectedRevision = baseRevision ?? serverRevision;
    if (
      isInFlightNoteSaveVisible({
        inFlight: noteSaveInFlightRef.current,
        noteIdentity,
        serverRevision,
        serverTitle,
        serverBody,
      })
    ) {
      setBaseRevision((current) =>
        current === null || current < serverRevision ? serverRevision : current,
      );
      saveBlockedRef.current = false;
      setSaveState("pending");
      return;
    }
    if (
      shouldBlockDirtyNoteAutosave({
        dirty,
        title,
        body,
        baseRevision: expectedRevision,
        serverTitle,
        serverBody,
        serverRevision,
      })
    ) {
      saveBlockedRef.current = true;
      setSaveState("conflict");
      writeNoteDraft(currentEntry, title, body, expectedRevision);
      return;
    }
    if (saveBlockedRef.current) {
      return;
    }
    if (noteSaveInFlightRef.current?.noteIdentity === noteIdentity) {
      setSaveState("pending");
      return;
    }
    setSaveState("pending");
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSaveState("saving");
      const inFlight: NoteSaveInFlight = {
        noteIdentity,
        expectedRevision,
        title,
        body,
      };
      noteSaveInFlightRef.current = inFlight;
      const saveEntry = entryRef.current;
      if (!saveEntry || noteDraftStorageKey(saveEntry) !== inFlight.noteIdentity) {
        noteSaveInFlightRef.current = null;
        return;
      }
      void onSaveRef.current(saveEntry, title, body, expectedRevision)
        .then((savedRevision) => {
          if (loadedNoteIdentityRef.current === inFlight.noteIdentity) {
            setBaseRevision((current) =>
              current === null || current < savedRevision ? savedRevision : current,
            );
          }
          if (!cancelled) {
            setSaveState("saved");
          }
        })
        .catch((caught) => {
          if (!cancelled) {
            saveBlockedRef.current = true;
            setSaveState(isNotesConflictError(caught) ? "conflict" : "error");
          }
        })
        .finally(() => {
          if (noteSaveInFlightRef.current === inFlight) {
            noteSaveInFlightRef.current = null;
            if (cancelled && loadedNoteIdentityRef.current === inFlight.noteIdentity) {
              setSaveRetryCycle((cycle) => cycle + 1);
            }
          }
        });
    }, 700);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    baseRevision,
    body,
    dirty,
    editorNoteIdentity,
    noteIdentity,
    saveRetryCycle,
    serverBody,
    serverRevision,
    serverTitle,
    title,
  ]);

  if (!entry) {
    return (
      <div className="note-editor note-editor-empty">
        <StickyNote size={24} />
        <span>Select or create a note</span>
      </div>
    );
  }

  const note = entry.note;
  const deleted = Boolean(note.deleted_at);
  const archived = Boolean(note.archived_at);
  const attachedToCurrentPane = scopedNoteLinkedToPane(entry, currentBridgeId, currentPaneId);
  const canViewLinkedPane = Boolean(
    entry.pane && (!attachedToCurrentPane || showCurrentPaneViewAction),
  );
  const canAttachCurrentPane = canAttachToCurrentPane && !attachedToCurrentPane;
  const saveStatusLabel =
    saveState === "error" ? "save failed" : saveState === "conflict" ? "conflict" : null;
  const markEdited = () => {
    const expectedRevision = baseRevision ?? entry.note.revision;
    if (baseRevision === null) {
      setBaseRevision(expectedRevision);
    }
    setDirty(true);
    if (saveState === "conflict") {
      writeNoteDraft(entry, title, body, expectedRevision);
      return;
    }
    saveBlockedRef.current = false;
    setSaveState("pending");
  };
  const overwriteConflict = () => {
    saveBlockedRef.current = false;
    setSaveState("saving");
    void onSave(entry, title, body, entry.note.revision)
      .then((savedRevision) => {
        clearNoteDraft(entry);
        setBaseRevision(savedRevision);
        setSaveState("saved");
      })
      .catch((caught) => {
        saveBlockedRef.current = true;
        setSaveState(isNotesConflictError(caught) ? "conflict" : "error");
      });
  };
  const useServerVersion = () => {
    setTitle(entry.note.title);
    setBody(entry.note.body);
    setDirty(false);
    setBaseRevision(entry.note.revision);
    saveBlockedRef.current = false;
    setSaveState("idle");
    clearNoteDraft(entry);
  };
  return (
    <div className="note-editor">
      <div className="note-editor-toolbar">
        <div className="note-editor-toolbar-left">
          <div className="note-editor-mode segmented-control" role="group" aria-label="Note editor mode">
            <button
              type="button"
              data-on={editorMode === "edit"}
              aria-pressed={editorMode === "edit"}
              onClick={() => setEditorMode("edit")}
            >
              Edit
            </button>
            <button
              type="button"
              data-on={editorMode === "preview"}
              aria-pressed={editorMode === "preview"}
              onClick={() => setEditorMode("preview")}
            >
              Preview
            </button>
          </div>
        </div>
        <div className="note-editor-actions">
          {canViewLinkedPane ? (
            <button className="icon-btn" type="button" aria-label="View pane" title="View pane" onClick={() => onViewPane(entry)}>
              <SquareTerminal size={16} />
            </button>
          ) : null}
          {note.attachment ? (
            <button className="icon-btn" type="button" aria-label="Detach note" title="Detach" onClick={() => onDetach(entry)}>
              <Unlink size={16} />
            </button>
          ) : null}
          {canAttachCurrentPane ? (
            <button
              className="icon-btn"
              type="button"
              aria-label="Attach to current pane"
              title="Attach to current pane"
              onClick={() => onAttachToCurrentPane(entry)}
            >
              <Link2 size={16} />
            </button>
          ) : null}
          {archived || deleted ? (
            <button className="icon-btn" type="button" aria-label="Restore note" title="Restore" onClick={() => onRestore(entry)}>
              <RotateCcw size={16} />
            </button>
          ) : (
            <button className="icon-btn" type="button" aria-label="Archive note" title="Archive" onClick={() => onArchive(entry)}>
              <Archive size={16} />
            </button>
          )}
          {!deleted ? (
            <button
              className="icon-btn danger"
              type="button"
              aria-label="Delete note"
              title="Delete"
              onClick={(event) => {
                focusOverlayTrigger(event.currentTarget);
                onDelete(entry);
              }}
            >
              <Trash2 size={16} />
            </button>
          ) : null}
        </div>
      </div>
      {saveState === "conflict" ? (
        <div className="note-conflict" role="alert">
          <span>This note changed elsewhere.</span>
          <button type="button" onClick={overwriteConflict}>
            Overwrite
          </button>
          <button type="button" onClick={useServerVersion}>
            Use server
          </button>
        </div>
      ) : null}
      <input
        ref={titleInputRef}
        className="note-title-input"
        value={title}
        onChange={(event) => {
          setTitle(event.currentTarget.value);
          markEdited();
        }}
        placeholder="Untitled note"
        disabled={deleted}
      />
      {editorMode === "preview" ? (
        <div className="note-body-preview">
          <Suspense fallback={<span className="note-body-preview-empty">Loading preview</span>}>
            <NoteMarkdownPreview body={body} />
          </Suspense>
        </div>
      ) : (
        <textarea
          className="note-body-input"
          value={body}
          onChange={(event) => {
            setBody(event.currentTarget.value);
            markEdited();
          }}
          placeholder="Write a note"
          disabled={deleted}
        />
      )}
      {saveStatusLabel ? (
        <span className="note-editor-save-status mono" data-state={saveState}>
          {saveStatusLabel}
        </span>
      ) : null}
    </div>
  );
}

function GroupHeader({
  label,
  bridgeColor,
  status,
  count,
  collapsed,
  nested = false,
  onToggle,
}: {
  label: string;
  bridgeColor?: string;
  status?: AgentStatus;
  count: number;
  collapsed: boolean;
  nested?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className="grp-space"
      type="button"
      data-group-header="true"
      data-nested={nested ? "true" : undefined}
      aria-expanded={!collapsed}
      aria-label={`${collapsed ? "Expand" : "Collapse"} ${label} group`}
      title={`${collapsed ? "Expand" : "Collapse"} ${label}`}
      onClick={onToggle}
    >
      {collapsed ? (
        <ChevronRight className="grp-space-chevron" size={13} aria-hidden="true" />
      ) : (
        <ChevronDown className="grp-space-chevron" size={13} aria-hidden="true" />
      )}
      {bridgeColor ? (
        <span
          className="bridge-chip-dot grp-bridge-dot"
          style={{ "--bridge-color": bridgeColor } as CSSProperties}
          aria-hidden="true"
        />
      ) : status ? (
        <span className="dot" data-status={status} />
      ) : null}
      {bridgeColor && status ? <span className="dot" data-status={status} /> : null}
      <span className="grp-space-name">{label}</span>
      <span className="grp-space-count mono">{count}</span>
      <span className="grp-space-line" />
    </button>
  );
}

function SpaceRow({
  workspace,
  bridgeLabel,
  agentCount,
  active,
  attention,
  index,
  reorderMember,
  reorderSource,
  reorderBusy,
  dropBefore,
  dropAfter,
  rowRef,
  reorderCardRef,
  onSelect,
  onMenu,
  onReorderPointerDown,
  onReorderPointerMove,
  onReorderPointerUp,
  onReorderPointerCancel,
  onReorderKeyDown,
  onCancelReorder,
}: {
  workspace: WorkspaceInfo;
  bridgeLabel?: string;
  agentCount: number;
  active: boolean;
  attention: number;
  index: number;
  reorderMember: boolean;
  reorderSource: boolean;
  reorderBusy: boolean;
  dropBefore: boolean;
  dropAfter: boolean;
  rowRef: (node: HTMLDivElement | null) => void;
  reorderCardRef?: MutableRefObject<HTMLButtonElement | null>;
  onSelect: () => void;
  onMenu: (x: number, y: number) => void;
  onReorderPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onReorderPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onReorderPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onReorderPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onReorderKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  onCancelReorder: () => void;
}) {
  const press = useLongPress(onMenu, onSelect);
  return (
    <div
      ref={rowRef}
      className="space-row-shell"
      data-reorder-member={reorderMember ? "true" : undefined}
      data-reorder-source={reorderSource ? "true" : undefined}
      data-drop-before={dropBefore ? "true" : undefined}
      data-drop-after={dropAfter ? "true" : undefined}
    >
      <button
        ref={reorderCardRef}
        className="space-row"
        type="button"
        data-active={active}
        data-reorder-drag={reorderSource ? "true" : undefined}
        disabled={reorderSource && reorderBusy}
        aria-label={reorderSource ? `Move ${workspace.label}` : undefined}
        aria-describedby={reorderSource ? SPACE_REORDER_INSTRUCTIONS_ID : undefined}
        style={{ animationDelay: `${Math.min(index, 14) * 22}ms` }}
        {...(reorderSource
          ? {
              onPointerDown: onReorderPointerDown,
              onPointerMove: onReorderPointerMove,
              onPointerUp: onReorderPointerUp,
              onPointerCancel: onReorderPointerCancel,
              onKeyDown: onReorderKeyDown,
            }
          : press)}
      >
        <span className="dot" data-status={workspace.agent_status} />
        <span className="space-body">
          <span className="space-name">{workspace.label}</span>
          <span className="space-sub mono">
            {spaceSubtitle(workspace, bridgeLabel, agentCount)}
          </span>
        </span>
        {attention > 0 ? <span className="attn">{attention}</span> : null}
      </button>
      {reorderSource ? (
        <span className="space-reorder-controls">
          <button
            className="space-reorder-cancel"
            type="button"
            disabled={reorderBusy}
            aria-label="Cancel moving space"
            title="Cancel"
            onClick={onCancelReorder}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </span>
      ) : null}
    </div>
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
  workspaceLabel,
  tabLabel,
  bridgeLabel,
  pinned,
  active,
  index,
  onSelect,
  onMenu,
}: {
  pane: PaneInfo;
  workspaceLabel?: string;
  tabLabel?: string;
  bridgeLabel?: string;
  pinned?: boolean;
  active: boolean;
  index: number;
  onSelect: () => void;
  onMenu: (x: number, y: number) => void;
}) {
  const press = useLongPress(onMenu, onSelect);
  const meta =
    workspaceLabel || tabLabel || bridgeLabel
      ? paneListSubtitle(pane, workspaceLabel, tabLabel, bridgeLabel)
      : paneMeta(pane);
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
        <span className="pane-name pane-title">
          <span className="pane-title-text">{paneTitle(pane)}</span>
        </span>
        {meta ? <span className="pane-meta mono">{meta}</span> : null}
      </span>
      {isLoud(pane.agent_status) ? (
        <span className="pane-word" data-status={pane.agent_status}>
          {statusLabel(pane.agent_status)}
        </span>
      ) : null}
      {pinned ? (
        <Pin className="agent-pin-indicator" size={10} aria-label="Pinned" />
      ) : null}
    </button>
  );
}

function AgentRow({
  pane,
  workspace,
  tabLabel,
  bridgeLabel,
  pinned,
  active,
  index,
  onSelect,
  onMenu,
}: {
  pane: PaneInfo;
  workspace?: WorkspaceInfo;
  tabLabel?: string;
  bridgeLabel?: string;
  pinned: boolean;
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
        <span className="pane-name pane-title">
          {iconKind ? <AgentIcon kind={iconKind} /> : null}
          {pinned ? (
            <Pin className="agent-pin-indicator" size={10} aria-label="Pinned" />
          ) : null}
          <span className="pane-title-text">{agentTitle(pane, workspace, tabLabel)}</span>
        </span>
        <span className="pane-meta mono">{agentSubtitle(pane, workspace, tabLabel, bridgeLabel)}</span>
      </span>
      {isLoud(pane.agent_status) ? (
        <span className="pane-word" data-status={pane.agent_status}>
          {statusLabel(pane.agent_status)}
        </span>
      ) : null}
    </button>
  );
}

function NoteRow({
  entry,
  active,
  showBridge,
  index,
  onSelect,
}: {
  entry: ScopedNoteEntry;
  active: boolean;
  showBridge: boolean;
  index: number;
  onSelect: () => void;
}) {
  const state = noteStateLabel(entry.note);
  return (
    <button
      className="pane-row note-row"
      type="button"
      data-active={active}
      data-link={entry.note.link_state}
      style={{ animationDelay: `${Math.min(index, 14) * 22}ms` }}
      onClick={onSelect}
    >
      <span
        className="bridge-chip-dot"
        style={{ "--bridge-color": entry.bridgeColor } as CSSProperties}
        aria-hidden="true"
      />
      <span className="pane-body">
        <span className="pane-name">{entry.note.title || "Untitled note"}</span>
        <span className="pane-meta mono">{noteSubtitle(entry, showBridge)}</span>
      </span>
      <NoteStateIcon note={entry.note} label={state.label} status={state.status} />
    </button>
  );
}

function DisconnectedBridgeRow({
  label,
  message,
  onSelect,
  onRetry,
}: {
  label: string;
  message: string;
  onSelect: () => void;
  onRetry: () => void;
}) {
  return (
    <button className="pane-row" type="button" data-status="unknown" onClick={onSelect}>
      <span className="dot" data-status="unknown" />
      <span className="pane-body">
        <span className="pane-name">{label}</span>
        <span className="pane-meta mono">{message}</span>
      </span>
      <span
        className="pane-word"
        data-status="working"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onRetry();
        }}
      >
        retry
      </span>
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

export function shouldRenderAgentRowInTabs(pane: PaneInfo, enabled: boolean) {
  return enabled && isAgentPane(pane);
}

function isAgentPane(pane: PaneInfo) {
  return Boolean(
    pane.agent ||
      pane.display_agent ||
      pane.title ||
      Object.keys(pane.state_labels ?? {}).length > 0 ||
      pane.agent_status !== "unknown",
  );
}

export function isActiveAgentStatus(status: AgentStatus) {
  return status === "working" || status === "blocked" || status === "done";
}

function emptyAgentListTitle(pinnedOnly: boolean, activeOnly: boolean) {
  if (pinnedOnly && activeOnly) {
    return "No pinned active status agents";
  }
  if (pinnedOnly) {
    return "No pinned agents";
  }
  if (activeOnly) {
    return "No active status agents";
  }
  return "No detected agents";
}

const AGENT_STATUS_ORDER: Record<AgentStatus, number> = {
  blocked: 0,
  working: 1,
  done: 2,
  idle: 3,
  unknown: 4,
};
const AGENT_ATTENTION_ORDER: Record<AgentStatus, number> = {
  blocked: 0,
  done: 1,
  working: 2,
  idle: 3,
  unknown: 4,
};

function sortAgentPanes(panes: PaneInfo[], sort: AgentSort, snapshot: Snapshot) {
  const workspaceNumber = new Map(
    snapshot.workspaces.map((workspace) => [workspace.workspace_id, workspace.number]),
  );
  const tabNumber = new Map(snapshot.tabs.map((tab) => [tab.tab_id, tab.number]));

  return [...panes].sort((a, b) => {
    if (sort === "attention") {
      const status = AGENT_ATTENTION_ORDER[a.agent_status] - AGENT_ATTENTION_ORDER[b.agent_status];
      if (status !== 0) {
        return status;
      }
    } else if (sort === "status") {
      const status = AGENT_STATUS_ORDER[a.agent_status] - AGENT_STATUS_ORDER[b.agent_status];
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

export function sortScopedAgentPanes(entries: ScopedAgentPane[], sort: AgentSort) {
  return [...entries].sort((a, b) => {
    if (sort === "attention") {
      const status =
        AGENT_ATTENTION_ORDER[a.pane.agent_status] - AGENT_ATTENTION_ORDER[b.pane.agent_status];
      if (status !== 0) {
        return status;
      }
      const activity = compareLastStatusTransition(a, b);
      if (activity !== 0) {
        return activity;
      }
    } else if (sort === "status") {
      const status =
        AGENT_STATUS_ORDER[a.pane.agent_status] - AGENT_STATUS_ORDER[b.pane.agent_status];
      if (status !== 0) {
        return status;
      }
    } else if (sort === "lastStatusChange") {
      const activity = compareLastStatusTransition(a, b);
      if (activity !== 0) {
        return activity;
      }
    }

    const bridge = a.bridgeIndex - b.bridgeIndex;
    if (bridge !== 0) {
      return bridge;
    }
    const workspace =
      (a.workspace?.number ?? Number.MAX_SAFE_INTEGER) -
      (b.workspace?.number ?? Number.MAX_SAFE_INTEGER);
    if (workspace !== 0) {
      return workspace;
    }
    const tab =
      (a.tabNumber ?? Number.MAX_SAFE_INTEGER) -
      (b.tabNumber ?? Number.MAX_SAFE_INTEGER);
    if (tab !== 0) {
      return tab;
    }
    return `${a.bridgeId}:${a.pane.pane_id}`.localeCompare(
      `${b.bridgeId}:${b.pane.pane_id}`,
      undefined,
      { numeric: true },
    );
  });
}

export function shouldShowLastStatusChangeSort(
  agentActivitySupported: boolean,
  agentSort: AgentSort,
) {
  return agentActivitySupported || agentSort === "lastStatusChange";
}

export function shouldShowSidebarSort(
  sidebarView: SidebarView,
  agentFeaturesInTabs: boolean,
) {
  return sidebarView === "agents" || (sidebarView === "tabs" && agentFeaturesInTabs);
}

export function shouldOfferSpaceHostGrouping(hostScope: HostScope, hostCount: number) {
  return hostScope === "all" && hostCount > 1;
}

export function resolveEffectiveSpaceGroup(
  spaceGroup: SpaceGroup,
  hostScope: HostScope,
  hostCount: number,
): SpaceGroup {
  return shouldOfferSpaceHostGrouping(hostScope, hostCount) ? spaceGroup : "none";
}

export function canAddNoteFromPaneMenu({
  kind,
  notesEnabled,
  runtimeCanConnect,
  capabilityState,
  notesSupported,
  runtimeConnectionKey,
  stateConnectionKey,
  paneExists,
}: {
  kind: MenuKind;
  notesEnabled: boolean;
  runtimeCanConnect: boolean;
  capabilityState: BridgeRuntime["capabilityState"];
  notesSupported: boolean;
  runtimeConnectionKey: string | null | undefined;
  stateConnectionKey: string | null | undefined;
  paneExists: boolean;
}) {
  return Boolean(
    kind === "pane" &&
      notesEnabled &&
      runtimeCanConnect &&
      capabilityState === "ready" &&
      notesSupported &&
      runtimeConnectionKey &&
      stateConnectionKey === runtimeConnectionKey &&
      paneExists,
  );
}

export function paneNoteListContains(
  notes: readonly PaneNote[],
  pane: PaneInfo,
  noteId: string,
) {
  return notesForPane(notes, pane.pane_id).some((note) => note.note_id === noteId);
}

function noteListContainsId(notes: readonly PaneNote[], noteId: string) {
  return notes.some((note) => note.note_id === noteId);
}

export function mergeCreatedPaneNoteList(
  notes: readonly PaneNote[],
  note: PaneNote,
  pane: PaneInfo,
) {
  const sourceNote = notes.find((item) => item.note_id === note.note_id) ?? note;
  const linkedNote = resolveCreatedPaneNoteForTarget(sourceNote, pane);
  return [linkedNote, ...notes.filter((item) => item.note_id !== linkedNote.note_id)].sort(
    compareNotes,
  );
}

export function mergePendingPaneNotesIntoList(
  notes: readonly PaneNote[],
  pending: readonly PendingCreatedPaneNoteTarget[],
) {
  let mergedNotes = [...notes];
  const remaining: PendingCreatedPaneNoteTarget[] = [];
  for (const entry of pending) {
    // Once the server returns the note id, its current link state is authoritative.
    if (noteListContainsId(mergedNotes, entry.note.note_id)) {
      continue;
    }
    mergedNotes = mergeCreatedPaneNoteList(mergedNotes, entry.note, entry.pane);
    remaining.push(entry);
  }
  return {
    notes: mergedNotes,
    pending: remaining,
  };
}

export function resolveCreatedPaneNoteForTarget(note: PaneNote, pane: PaneInfo): PaneNote {
  const existingAttachment = note.attachment?.type === "pane" ? note.attachment : null;
  const attachment: NoteAttachment = {
    type: "pane",
    pane_id: pane.pane_id,
    workspace_id: pane.workspace_id,
    tab_id: pane.tab_id,
    terminal_id: pane.terminal_id,
    pane_revision: pane.revision,
    captured_at: existingAttachment?.captured_at ?? note.created_at,
    context: existingAttachment?.context ?? {},
  };
  if (existingAttachment?.observed_generation) {
    attachment.observed_generation = existingAttachment.observed_generation;
  }
  return {
    ...note,
    attachment,
    attachment_history: note.attachment_history ?? [],
    link_state: "linked",
    resolved_pane: pane,
  };
}

function compareLastStatusTransition(a: ScopedAgentPane, b: ScopedAgentPane) {
  // Values are bridge-observed wall-clock times. Across hosts, clock skew can
  // affect exact ordering, so existing bridge/workspace fallback order remains
  // the deterministic tie and no-timestamp behavior.
  const aTransition = a.lastStatusTransitionAt;
  const bTransition = b.lastStatusTransitionAt;
  const hasA = typeof aTransition === "number";
  const hasB = typeof bTransition === "number";
  if (hasA !== hasB) {
    return hasA ? -1 : 1;
  }
  if (hasA && hasB && aTransition !== bTransition) {
    return bTransition - aTransition;
  }
  return 0;
}

export function agentTitle(pane: PaneInfo, workspace?: WorkspaceInfo, tabLabel?: string) {
  // The workspace/tab name distinguishes agent windows from one another; the
  // agent binary name (e.g. "claude") is the same across every row and isn't
  // useful as the primary label — it still shows up via the agent icon.
  return (
    workspace?.label?.trim() ||
    tabLabel?.trim() ||
    pane.display_agent ||
    pane.label ||
    pane.agent ||
    pane.title ||
    paneTitle(pane)
  );
}

export function agentSubtitle(
  pane: PaneInfo,
  workspace?: WorkspaceInfo,
  tabLabel?: string,
  bridgeLabel?: string,
) {
  const dir = basename(pane.foreground_cwd || pane.cwd);
  const stateText = pane.state_labels?.[pane.agent_status];
  // Drop whichever context part was promoted to the title so the row does not
  // repeat itself.
  const title = agentTitle(pane, workspace, tabLabel);
  const parts = [bridgeLabel];
  if (workspace?.label && workspace.label !== title) {
    parts.push(workspace.label);
  }
  if (tabLabel && tabLabel !== title) {
    parts.push(tabLabel);
  }
  if (dir && dir !== title) {
    parts.push(dir);
  }
  parts.push(stateText);
  return parts.filter(Boolean).join(" · ");
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

export function menuItems(
  kind: MenuKind,
  paneMoveSupported: boolean,
  commandsReady: boolean,
  agentPinsSupported = false,
  panePinned = false,
  pinLabel: "agent" | "pane" = "pane",
  notesSupported = false,
  workspaceReorderSupported = false,
): MenuItem[] {
  if (kind === "space") {
    if (!commandsReady) {
      return [];
    }
    const items: MenuItem[] = [
      { key: "rename", label: "Rename" },
      { key: "newtab", label: "New tab" },
    ];
    if (workspaceReorderSupported) {
      items.push({ key: "reorder", label: "Move space" });
    }
    items.push({ key: "close", label: "Close space", danger: true });
    return items;
  }
  if (kind === "tab") {
    if (!commandsReady) {
      return [];
    }
    return [
      { key: "rename", label: "Rename" },
      { key: "close", label: "Close tab", danger: true },
    ];
  }
  const paneItems: MenuItem[] = [];
  if (agentPinsSupported) {
    const target = pinLabel === "agent" ? "agent" : "pane";
    paneItems.push({
      key: panePinned ? "unpin" : "pin",
      label: panePinned ? `Unpin ${target}` : `Pin ${target}`,
    });
  }
  if (notesSupported) {
    paneItems.push({ key: "add_note", label: "Add note" });
  }
  if (!commandsReady) {
    return paneItems;
  }
  paneItems.push({ key: "rename", label: "Rename" });
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
  const response = await fetchWithTimeout(httpUrl("/api/snapshot"));
  if (!response.ok) {
    throw new Error(`snapshot failed: ${response.status}`);
  }
  return (await response.json()) as Snapshot;
}

function disconnectedHttpUrl(): string {
  throw new Error("Bridge is not connected");
}

function disconnectedWsUrl(): string {
  throw new Error("Bridge is not connected");
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

function isNotesChangedEvent(event: MessageEvent) {
  if (typeof event.data !== "string") {
    return false;
  }
  try {
    const parsed = JSON.parse(event.data) as { type?: unknown };
    return parsed.type === "herdr_web.notes_changed";
  } catch {
    return false;
  }
}

function isAgentActivityChangedEvent(event: MessageEvent) {
  if (typeof event.data !== "string") {
    return false;
  }
  try {
    const parsed = JSON.parse(event.data) as { type?: unknown };
    return parsed.type === "herdr_web.agent_activity_changed";
  } catch {
    return false;
  }
}

function isAgentPinsChangedEvent(event: MessageEvent) {
  if (typeof event.data !== "string") {
    return false;
  }
  try {
    const parsed = JSON.parse(event.data) as { type?: unknown };
    return parsed.type === "herdr_web.agent_pins_changed";
  } catch {
    return false;
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
  options: { onOpen?: () => void } = {},
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
      options.onOpen?.();
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
