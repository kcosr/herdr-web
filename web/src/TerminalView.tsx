import {
  ChevronsDown,
  Copy,
  ExternalLink,
  Keyboard,
  Link,
  Paperclip,
  Send,
  Smartphone,
  SkipForward,
  SquareTerminal,
  TextCursorInput,
  X,
} from "lucide-react";
import ConnectionConflictCard from "./ConnectionConflictCard";
import { useLongPress } from "./overlays";
import {


  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ChangeEvent, ClipboardEvent, DragEvent, KeyboardEvent, RefObject } from "react";
import { autosizeMobileCommandTextarea } from "./mobileCommandTextarea";
import { ConfirmDialog } from "./overlays";
import { addNativeResumeHandler } from "./native";
import { shellQuote } from "./shell";
import {
  isNonRetryableTerminalClose,
  isTerminalAttachConflictClose,
  MAX_TERMINAL_ATTACH_CONFLICT_RETRIES,
  parseTerminalCloseReason,
  terminalConnectionCopy,
  terminalConnectionOverlayDelayMs,
} from "./terminalConnectionStatus";
import type { TerminalConnectionState } from "./terminalConnectionStatus";
import {
  findFirstUrlInSelection,
  normalizeMobileTerminalCopyText,
  openableHttpUrl,
} from "./terminalSelection";
import { GhosttyRenderer } from "./terminalRenderer";
import type { Theme } from "./theme";
import type { MobileTerminalTouchEvent, TerminalRenderer, TerminalSize } from "./terminalRenderer";
import {
  appendTerminalInputBatch,
  drainTerminalInputBatch,
  emptyTerminalInputBatch,
  shouldSendTerminalInputImmediately,
} from "./terminalInputTransport";
import type { TerminalInputTransport } from "./terminalInputTransport";
import { DEFAULT_TERMINAL_OUTPUT_COALESCE_MS } from "./terminalOutputCoalescing";
import {
  createTerminalOutputFrameDecoder,
  isTerminalOutputGzipAcknowledgement,
  terminalOutputGzipSupported,
} from "./terminalOutputEncoding";
import { DEFAULT_TERMINAL_FONT_SIZE_PX } from "./terminalPrefs";
import {
  TERMINAL_FOREGROUND_FAST_ATTEMPTS,
  TERMINAL_FOREGROUND_CONNECT_TIMEOUT_MS,
  TERMINAL_FOREGROUND_SIGNAL_COALESCE_MS,
  terminalReconnectPolicy,
} from "./terminalReconnectPolicy";
import type { TerminalReconnectMode } from "./terminalReconnectPolicy";
import {
  DEFAULT_MOBILE_COMPACT_CONTROLS,
  DEFAULT_MOBILE_TOUCH_SELECTION_ENDPOINT_TIMEOUT_MS,
} from "./mobileTerminalPrefs";
import type {
  MobileLongPressBehavior,
  MobileTerminalTapTarget,
  MobileTouchSelectionEndpointTimeoutMs,
} from "./mobileTerminalPrefs";
import {
  advanceTerminalScrollOffset,
  isTerminalScrolledAwayFromPresent,
} from "./terminalScrollPresence";
import type { PaneInfo } from "./types";

import { ParlayInput } from "./ParlayInput";

type Props = {
  pane: PaneInfo | null;
  connectionKey: string;
  resumeToken: number;
  httpUrl: (path: string, query?: URLSearchParams) => string;
  wsUrl: (path: string, query?: URLSearchParams) => string;
  /** Whether to grab keyboard focus on attach. Off on mobile to avoid popping the keyboard. */
  autoFocus?: boolean;
  /** Wheel scroll speed multiplier; slower on desktop, faster on mobile. */
  scrollSensitivity?: number;
  /** Supplemental browser-native input controls for narrow touch screens. */
  mobileControls?: boolean;
  /** Whether the terminal cursor blinks. Off on touch devices. */
  cursorBlink?: boolean;
  /** App light/dark theme; the terminal palette is baked in when the pane is (re)created. */
  theme?: Theme;
  /** Terminal renderer font size in CSS pixels. */
  terminalFontSizePx?: number;
  /** Percentage scale applied to mobile terminal controls. */
  mobileControlsScalePercent?: number;
  /** Whether the mobile special-keys row is collapsed to save vertical space. */
  mobileCompactControls?: boolean;
  /** Called when the captain toggles the mobile compact-controls state. */
  onMobileCompactControlsChange?: (compact: boolean) => void;
  /** Where terminal taps should send focus on mobile. */
  mobileTapTarget?: MobileTerminalTapTarget;
  /** Gesture behavior for long-presses on touch terminals. */
  mobileLongPressBehavior?: MobileLongPressBehavior;
  /** How long the loupe endpoint waits for a second drag. */
  mobileTouchSelectionEndpointTimeoutMs?: MobileTouchSelectionEndpointTimeoutMs;
  /** Whether the mobile command input wraps and grows while editing. */
  mobileCommandExpandingInput?: boolean;
  /** Whether Enter inserts a newline in the expanding mobile command input. */
  mobileCommandEnterNewline?: boolean;
  /** Browser-to-bridge transport for terminal input payloads. */
  terminalInputTransport?: TerminalInputTransport;
  /** Delay for coalescing short terminal input payloads. Zero disables batching. */
  terminalInputBatchDelayMs?: number;
  /** Delay for coalescing terminal output frames. Zero disables output batching. */
  terminalOutputCoalesceMs?: number;
  /** Incrementing token from the parent that requests an immediate fit+resize. */
  refitToken?: number;
  /** Incrementing token from the parent that requests focus on the preferred terminal input. */
  focusToken?: number;
  /** Advance to the next agent pane (mobile "next agent"/"next tab" command). */
  onNextAgentPane?: () => void;
  /** True when the active pane is pinned; tints the mobile control row. */
  pinned?: boolean;
  /** Cycles the pane-cycle button through whichever pool paneCycleMode selects. */
  onPaneCycle?: (direction: "next" | "prev") => void;
  /** Long-press on the pane-cycle button toggles between pinned-only and all panes. */
  onPaneCycleModeToggle?: () => void;
  paneCycleMode?: "pin" | "all";
  /** Return to the previous agent pane (mobile "previous agent" command). */
  onPrevAgentPane?: () => void;
  /** Whether to maintain a hidden plain-text mirror of the visible terminal viewport. */
  terminalScreenReaderText?: boolean;
  /** Talk Back: receives screen-reader-safe plain text after terminal writes (project-jzd). */
  onAccessibleTextChange?: (text: string) => void;
  /** Pane-specific accessible name for the terminal and its screen mirror. */
  accessibilityLabel?: string;
  /** Whether this is the currently selected terminal in a split. */
  selected?: boolean;
};

type UploadCandidate = {
  blob: Blob;
  name: string | null;
};
type UploadedFile = {
  name: string;
  path: string;
  size: number;
  mime?: string | null;
};
type UploadConflictState = {
  name: string;
  path: string;
  resolve: (replace: boolean) => void;
};
type MobileSelectionAction = {
  text: string;
  url: string;
};
type ReconnectReason =
  | "initial"
  | "close"
  | "error"
  | "stalled"
  | "resume"
  | "visible"
  | "online"
  | "resize"
  | "manual";
type TerminalRendererReady = {
  terminalId: string;
  generation: number;
  renderer: TerminalRenderer;
  measure: (mode?: "fit" | "refresh") => TerminalSize | null;
};
const MAX_UPLOAD_FILES = 8;
const DEBUG_TERMINAL_RECONNECT = false;
// Mount, the ResizeObserver's initial callback, and document.fonts.ready all
// fire within a few ms of each other on a fresh pane and each would otherwise
// send its own "resize" over the socket — one full reflow/redraw round trip
// per send. Harmless on a local bridge; visibly slow and chunky over a
// remote-proxied (double-hop) connection. Coalescing to the last one in this
// window cuts that to at most one corrective resize after the first connect.
const TERMINAL_RESIZE_SETTLE_MS = 120;

export function TerminalView({
  pane,
  connectionKey,
  resumeToken,
  httpUrl,
  wsUrl,
  autoFocus = true,
  scrollSensitivity = 1,
  mobileControls = false,
  cursorBlink = true,
  theme = "dark",
  terminalFontSizePx = DEFAULT_TERMINAL_FONT_SIZE_PX,
  mobileControlsScalePercent = 100,
  mobileCompactControls = DEFAULT_MOBILE_COMPACT_CONTROLS,
  onMobileCompactControlsChange = () => {},
  mobileTapTarget = "command-input",
  mobileLongPressBehavior = "off",
  mobileTouchSelectionEndpointTimeoutMs = DEFAULT_MOBILE_TOUCH_SELECTION_ENDPOINT_TIMEOUT_MS,
  mobileCommandExpandingInput = false,
  mobileCommandEnterNewline = false,
  terminalInputTransport = "json",
  terminalInputBatchDelayMs = 0,
  terminalOutputCoalesceMs = DEFAULT_TERMINAL_OUTPUT_COALESCE_MS,
  refitToken = 0,
  focusToken = 0,
  onNextAgentPane = () => {},
  pinned = false,
  onPaneCycle = () => {},
  onPaneCycleModeToggle = () => {},
  paneCycleMode = "pin",
  onPrevAgentPane = () => {},
  terminalScreenReaderText = false,
  onAccessibleTextChange,
  accessibilityLabel = "Terminal",
  selected = false,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mobileCommandInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const rendererRef = useRef<TerminalRenderer | null>(null);
  const rendererGenerationRef = useRef(0);
  const rendererReadyRef = useRef<TerminalRendererReady | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const requestReconnectRef = useRef<(reason: ReconnectReason) => void>(() => {});
  const terminalInputBlockedRef = useRef(false);
  const uploadInputId = useId();
  const sendResizeRef = useRef<(size: TerminalSize) => void>(() => {});
  const inputQueueRef = useRef<string[]>([]);
  const inputFlushTimerRef = useRef<number | null>(null);
  const batchedInputRef = useRef(emptyTerminalInputBatch());
  const batchedInputFlushTimerRef = useRef<number | null>(null);
  const terminalInputEncoderRef = useRef(new TextEncoder());
  const uploadStatusTimerRef = useRef<number | null>(null);
  const uploadInFlightRef = useRef(false);
  const uploadConflictRef = useRef<UploadConflictState | null>(null);
  const connectionKeyRef = useRef(connectionKey);
  const terminalIdRef = useRef(pane?.terminal_id ?? null);
  const overlayTerminalIdRef = useRef(pane?.terminal_id ?? null);
  const delayConnectingOverlayRef = useRef(false);
  // Net lines the user has scrolled up by, tracked per TerminalView instance so each
  // split-grid pane shows its own jump-to-present control independently.
  const terminalScrollOffsetRef = useRef(0);
  const [connectionState, setConnectionState] = useState<TerminalConnectionState>("idle");
  const [closeReason, setCloseReason] = useState<string | null>(null);
  const [rendererReady, setRendererReady] = useState<TerminalRendererReady | null>(null);
  const [accessibleScreen, setAccessibleScreen] = useState("");
  const [hasAttachedForTerminal, setHasAttachedForTerminal] = useState(false);
  const [showConnectionOverlay, setShowConnectionOverlay] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadConflict, setUploadConflict] = useState<UploadConflictState | null>(null);
  const [mobileSelectionAction, setMobileSelectionAction] =
    useState<MobileSelectionAction | null>(null);
  const [mobileModeActive, setMobileModeActive] = useState(false);
  const [scrolledAwayFromPresent, setScrolledAwayFromPresent] = useState(false);
  // Read at attach time without re-running the effect (which would re-attach the socket).
  const autoFocusRef = useRef(autoFocus);
  autoFocusRef.current = autoFocus;
  const scrollSensitivityRef = useRef(scrollSensitivity);
  scrollSensitivityRef.current = scrollSensitivity;
  const mobileControlsRef = useRef(mobileControls);
  mobileControlsRef.current = mobileControls;
  const cursorBlinkRef = useRef(cursorBlink);
  cursorBlinkRef.current = cursorBlink;
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const terminalFontSizePxRef = useRef(terminalFontSizePx);
  terminalFontSizePxRef.current = terminalFontSizePx;
  const mobileTapTargetRef = useRef(mobileTapTarget);
  mobileTapTargetRef.current = mobileTapTarget;
  const mobileLongPressBehaviorRef = useRef(mobileLongPressBehavior);
  mobileLongPressBehaviorRef.current = mobileLongPressBehavior;
  const mobileTouchSelectionEndpointTimeoutMsRef = useRef(
    mobileTouchSelectionEndpointTimeoutMs,
  );
  mobileTouchSelectionEndpointTimeoutMsRef.current = mobileTouchSelectionEndpointTimeoutMs;
  const terminalInputTransportRef = useRef(terminalInputTransport);
  terminalInputTransportRef.current = terminalInputTransport;
  const terminalInputBatchDelayMsRef = useRef(terminalInputBatchDelayMs);
  terminalInputBatchDelayMsRef.current = terminalInputBatchDelayMs;
  connectionKeyRef.current = connectionKey;
  terminalIdRef.current = pane?.terminal_id ?? null;

  const focusMobileCommandInput = useCallback(() => {
    if (!mobileControlsRef.current) {
      return false;
    }
    const input = mobileCommandInputRef.current;
    if (!input || input.disabled) {
      return true;
    }
    input.focus();
    return true;
  }, []);

  const setMobileControlsHeight = useCallback((heightPx: number | null) => {
    if (heightPx === null) {
      stageRef.current?.style.removeProperty("--terminal-mobile-controls-height");
      return;
    }
    stageRef.current?.style.setProperty(
      "--terminal-mobile-controls-height",
      `${Math.ceil(heightPx)}px`,
    );
  }, []);

  const focusTerminalKeyboardInput = useCallback(() => {
    rendererRef.current?.focusTextInput();
    return "terminal" as const;
  }, []);

  const focusPreferredInput = useCallback(() => {
    if (mobileControlsRef.current && mobileTapTargetRef.current === "terminal") {
      rendererRef.current?.focusTextInput();
      return;
    }
    if (!focusMobileCommandInput()) {
      rendererRef.current?.focusTextInput();
    }
  }, [focusMobileCommandInput]);

  const showUploadStatus = useCallback((message: string | null, timeoutMs?: number) => {
    if (uploadStatusTimerRef.current !== null) {
      window.clearTimeout(uploadStatusTimerRef.current);
      uploadStatusTimerRef.current = null;
    }
    setUploadStatus(message);
    if (message && timeoutMs) {
      uploadStatusTimerRef.current = window.setTimeout(() => {
        uploadStatusTimerRef.current = null;
        setUploadStatus(null);
      }, timeoutMs);
    }
  }, []);

  const copyText = useCallback(
    async (text: string, successMessage: string) => {
      try {
        await copyToClipboard(text);
        showUploadStatus(successMessage, 2200);
      } catch (error) {
        console.warn("selection copy failed", error);
        showUploadStatus("Copy failed", 3000);
      }
    },
    [showUploadStatus],
  );

  const handleMobileTerminalTouch = useCallback(
    (event: MobileTerminalTouchEvent) => {
      if (event.type === "url") {
        const url = openableHttpUrl(event.url);
        if (url) {
          window.open(url, "_blank", "noopener,noreferrer");
        }
        return;
      }
      const copiedText = normalizeMobileTerminalCopyText(event.text).trim();
      setMobileSelectionAction(null);
      if (!copiedText) {
        rendererRef.current?.clearSelection();
        return;
      }
      const url = findFirstUrlInSelection(copiedText);
      if (url) {
        setMobileSelectionAction({ text: copiedText, url });
        return;
      }
      rendererRef.current?.clearSelection();
      void copyText(copiedText, "Copied selection");
    },
    [copyText],
  );

  const measureTerminal = useCallback(
    (renderer: TerminalRenderer, mode: "fit" | "refresh" = "fit") => {
      try {
        return mode === "refresh" ? renderer.refreshMetrics() : renderer.fit();
      } catch (error) {
        if (rendererRef.current === renderer) {
          console.warn("terminal resize skipped", error);
        }
        return null;
      }
    },
    [],
  );

  const resizeTerminal = useCallback(
    (mode: "fit" | "refresh" = "fit") => {
      const renderer = rendererRef.current;
      if (!renderer) {
        return;
      }
      const size = measureTerminal(renderer, mode);
      if (size) {
        sendResizeRef.current(size);
      }
    },
    [measureTerminal],
  );

  const sendTerminalInputFrame = useCallback(
    (socket: WebSocket, data: string) => {
      if (terminalInputTransportRef.current === "binary") {
        const encoded = terminalInputEncoderRef.current.encode(data);
        socket.send(encoded);
        return;
      }
      const payload = JSON.stringify({ type: "input", data });
      socket.send(payload);
    },
    [],
  );

  const clearBatchedInputTimer = useCallback(() => {
    if (batchedInputFlushTimerRef.current !== null) {
      window.clearTimeout(batchedInputFlushTimerRef.current);
      batchedInputFlushTimerRef.current = null;
    }
  }, []);

  const clearQueuedTerminalInput = useCallback(() => {
    inputQueueRef.current = [];
    if (inputFlushTimerRef.current !== null) {
      window.clearTimeout(inputFlushTimerRef.current);
      inputFlushTimerRef.current = null;
    }
  }, []);

  const flushQueuedTerminalInput = useCallback(() => {
    if (inputFlushTimerRef.current !== null) {
      window.clearTimeout(inputFlushTimerRef.current);
      inputFlushTimerRef.current = null;
    }
    const flush = () => {
      inputFlushTimerRef.current = null;
      const socket = socketRef.current;
      if (socket?.readyState !== WebSocket.OPEN) {
        return;
      }
      const next = inputQueueRef.current.shift();
      if (next !== undefined) {
        sendTerminalInputFrame(socket, next);
      }
      if (inputQueueRef.current.length > 0) {
        inputFlushTimerRef.current = window.setTimeout(flush, 35);
      }
    };
    flush();
  }, [sendTerminalInputFrame]);

  const flushBatchedTerminalInput = useCallback(() => {
    clearBatchedInputTimer();
    const pending = batchedInputRef.current;
    if (pending.parts.length === 0) {
      batchedInputRef.current = emptyTerminalInputBatch();
      return;
    }
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) {
      return;
    }
    const drained = drainTerminalInputBatch(pending);
    batchedInputRef.current = drained.batch;
    if (drained.data !== null) {
      sendTerminalInputFrame(socket, drained.data);
    }
  }, [clearBatchedInputTimer, sendTerminalInputFrame]);

  const scheduleBatchedTerminalInputFlush = useCallback(() => {
    clearBatchedInputTimer();
    const delayMs = terminalInputBatchDelayMsRef.current;
    batchedInputFlushTimerRef.current = window.setTimeout(flushBatchedTerminalInput, delayMs);
  }, [clearBatchedInputTimer, flushBatchedTerminalInput]);

  const sendTerminalInputData = useCallback(
    (data: string) => {
      const socket = socketRef.current;
      if (socket?.readyState !== WebSocket.OPEN) {
        return;
      }
      const delayMs = terminalInputBatchDelayMsRef.current;
      const bytes = terminalInputEncoderRef.current.encode(data).byteLength;
      if (shouldSendTerminalInputImmediately(bytes, delayMs)) {
        flushBatchedTerminalInput();
        sendTerminalInputFrame(socket, data);
        return;
      }
      const result = appendTerminalInputBatch(batchedInputRef.current, data, bytes);
      batchedInputRef.current = result.batch;
      if (result.shouldFlush) {
        flushBatchedTerminalInput();
        return;
      }
      if (batchedInputFlushTimerRef.current === null) {
        scheduleBatchedTerminalInputFlush();
      }
    },
    [flushBatchedTerminalInput, scheduleBatchedTerminalInputFlush, sendTerminalInputFrame],
  );

  const jumpToTerminalPresent = useCallback(() => {
    // All output is written to the local terminal buffer regardless of scroll position
    // (see the socket message handler), so returning to present is a local viewport reset
    // — no server round trip needed, and nothing to undershoot if output kept streaming
    // in while scrolled away.
    terminalScrollOffsetRef.current = 0;
    setScrolledAwayFromPresent(false);
    rendererRef.current?.scrollToBottom();
    focusPreferredInput();
  }, [focusPreferredInput]);

  useEffect(() => {
    if (terminalInputBatchDelayMs <= 0) {
      flushBatchedTerminalInput();
    }
  }, [flushBatchedTerminalInput, terminalInputBatchDelayMs]);

  // Re-apply scroll tuning live when crossing the desktop/mobile breakpoint,
  // without tearing down the socket.
  useEffect(() => {
    rendererRef.current?.setScrollSensitivity(scrollSensitivity);
  }, [scrollSensitivity]);

  useEffect(() => {
    if (focusToken === 0) {
      return;
    }
    const focus = () => focusPreferredInput();
    const frame = window.requestAnimationFrame(focus);
    const timers = [80, 220].map((delay) => window.setTimeout(focus, delay));
    return () => {
      window.cancelAnimationFrame(frame);
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
    };
  }, [focusPreferredInput, focusToken]);

  useEffect(() => {
    const host = hostRef.current;
    const terminalId = pane?.terminal_id ?? null;
    const previousOverlayTerminalId = overlayTerminalIdRef.current;
    delayConnectingOverlayRef.current = Boolean(
      terminalId && previousOverlayTerminalId && previousOverlayTerminalId !== terminalId,
    );
    overlayTerminalIdRef.current = terminalId;
    rendererReadyRef.current = null;
    setRendererReady(null);
    setAccessibleScreen("");
    setHasAttachedForTerminal(false);
    setShowConnectionOverlay(false);
    setCloseReason(null);
    terminalInputBlockedRef.current = false;
    terminalScrollOffsetRef.current = 0;
    setScrolledAwayFromPresent(false);
    if (!host || !terminalId) {
      setConnectionState("idle");
      host?.replaceChildren();
      return;
    }

    host.replaceChildren();
    let disposed = false;
    let disposeInput: (() => void) | null = null;
    let disposeScroll: (() => void) | null = null;
    let resizeObserver: ResizeObserver | null = null;
    const generation = rendererGenerationRef.current + 1;
    rendererGenerationRef.current = generation;
    const renderer: TerminalRenderer = new GhosttyRenderer(
      terminalFontSizePxRef.current,
      cursorBlinkRef.current,
      themeRef.current,
    );
    rendererRef.current = renderer;
    setConnectionState("connecting");

    const measure = (mode: "fit" | "refresh" = "fit") => measureTerminal(renderer, mode);
    const publishReady = (mode: "fit" | "refresh" = "fit") => {
      if (disposed || rendererRef.current !== renderer) {
        return;
      }
      const size = measure(mode);
      if (!size) {
        return;
      }
      if (rendererReadyRef.current?.generation !== generation) {
        const ready = { terminalId, generation, renderer, measure };
        rendererReadyRef.current = ready;
        setRendererReady(ready);
      }
      sendResizeRef.current(size);
    };
    let settleTimer: number | null = null;
    let pendingSettleMode: "fit" | "refresh" = "fit";
    const scheduleSettledPublish = (mode: "fit" | "refresh") => {
      pendingSettleMode = pendingSettleMode === "refresh" ? "refresh" : mode;
      if (settleTimer !== null) {
        window.clearTimeout(settleTimer);
      }
      settleTimer = window.setTimeout(() => {
        settleTimer = null;
        const flushMode = pendingSettleMode;
        pendingSettleMode = "fit";
        publishReady(flushMode);
      }, TERMINAL_RESIZE_SETTLE_MS);
    };

    void renderer
      .mount(host)
      .then(() => {
        if (disposed) {
          return;
        }

        renderer.setScrollSensitivity(scrollSensitivityRef.current);
        renderer.setTapFocusHandler(
          !mobileControlsRef.current
            ? null
            : mobileTapTargetRef.current === "command-input"
              ? focusMobileCommandInput
              : focusTerminalKeyboardInput,
        );
        renderer.setMobileTouchSelection(
          mobileControlsRef.current ? mobileLongPressBehaviorRef.current : "off",
          mobileControlsRef.current ? handleMobileTerminalTouch : null,
          mobileTouchSelectionEndpointTimeoutMsRef.current,
        );

        disposeInput = renderer.onInput((data) => {
          sendTerminalInputData(data);
        });
        disposeScroll = renderer.onScroll((lines) => {
          const socket = socketRef.current;
          if (socket?.readyState !== WebSocket.OPEN || lines === 0) {
            return;
          }
          socket.send(
            JSON.stringify({
              type: "scroll",
              direction: lines < 0 ? "up" : "down",
              lines: Math.min(Math.abs(lines), 200),
            }),
          );
          const wasScrolledAway = isTerminalScrolledAwayFromPresent(
            terminalScrollOffsetRef.current,
          );
          terminalScrollOffsetRef.current = advanceTerminalScrollOffset(
            terminalScrollOffsetRef.current,
            lines,
          );
          const isScrolledAway = isTerminalScrolledAwayFromPresent(
            terminalScrollOffsetRef.current,
          );
          if (isScrolledAway !== wasScrolledAway) {
            setScrolledAwayFromPresent(isScrolledAway);
          }
        });

        resizeObserver = new ResizeObserver(() => {
          scheduleSettledPublish("fit");
          if (socketRef.current?.readyState !== WebSocket.OPEN) {
            requestReconnectRef.current("resize");
          }
        });
        resizeObserver.observe(host);

        const fontReady = document.fonts?.ready;
        if (fontReady) {
          void fontReady.then(() => {
            if (!disposed) {
              scheduleSettledPublish("refresh");
            }
          });
        }
        // Preload the lazy Nerd Font face; fonts.ready resolves before it loads.
        void document.fonts
          ?.load('13px "JetBrainsMono Nerd Font Mono"', "\uE0B0")
          .then(() => {
            if (!disposed) {
              scheduleSettledPublish("refresh");
            }
          })
          .catch(() => undefined);

        publishReady();
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }
        console.error("failed to mount terminal renderer", error);
        setConnectionState("error");
      });

    return () => {
      disposed = true;
      if (settleTimer !== null) {
        window.clearTimeout(settleTimer);
      }
      flushBatchedTerminalInput();
      batchedInputRef.current = emptyTerminalInputBatch();
      clearQueuedTerminalInput();
      disposeInput?.();
      disposeScroll?.();
      resizeObserver?.disconnect();
      if (rendererReadyRef.current?.generation === generation) {
        rendererReadyRef.current = null;
        setRendererReady(null);
      }
      sendResizeRef.current = () => {};
      renderer.dispose();
      if (rendererRef.current === renderer) {
        rendererRef.current = null;
      }
      host.replaceChildren();
    };
  }, [
    connectionKey,
    clearQueuedTerminalInput,
    flushBatchedTerminalInput,
    focusMobileCommandInput,
    focusTerminalKeyboardInput,
    handleMobileTerminalTouch,
    measureTerminal,
    pane?.terminal_id,
    sendTerminalInputData,
  ]);

  useEffect(() => {
    setAccessibleScreen("");
    const ready = rendererReady;
    const talkBackActive = typeof onAccessibleTextChange === "function";
    if ((!terminalScreenReaderText && !talkBackActive) || !ready) {
      ready?.renderer.setAccessibleScreenListener(null);
      return;
    }

    const { renderer, generation, terminalId } = ready;
    renderer.setAccessibleScreenListener((text) => {
      if (
        rendererRef.current === renderer &&
        rendererGenerationRef.current === generation &&
        terminalIdRef.current === terminalId
      ) {
        if (terminalScreenReaderText) {
          setAccessibleScreen(text);
        }
        onAccessibleTextChange?.(text);
      }
    });
    return () => renderer.setAccessibleScreenListener(null);
  }, [rendererReady, terminalScreenReaderText, onAccessibleTextChange]);

  useEffect(() => {
    const terminalId = pane?.terminal_id ?? null;
    const ready = rendererReady;
    if (!terminalId) {
      setConnectionState("idle");
      requestReconnectRef.current = () => {};
      return;
    }
    if (
      !ready ||
      ready.terminalId !== terminalId ||
      rendererReadyRef.current !== ready ||
      rendererRef.current !== ready.renderer
    ) {
      setConnectionState("connecting");
      requestReconnectRef.current = () => {};
      return;
    }

    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let connectTimer: number | null = null;
    let foregroundCoalesceTimer: number | null = null;
    let reconnectAttempts = 0;
    let foregroundFastAttemptsRemaining = 0;
    let attachConflictRetries = 0;
    let lastCloseReason: string | null = null;
    let socketGeneration = 0;
    let socketStartedAt = 0;
    let lastForegroundReconnectAt = Number.NEGATIVE_INFINITY;
    let reconnectStopped = false;
    const reconnectScheduledForSocket = new Set<number>();
    const pendingForegroundReasons = new Set<ReconnectReason>();

    const debugReconnect = (event: string, details: Record<string, unknown> = {}) => {
      if (DEBUG_TERMINAL_RECONNECT) {
        console.debug("terminal reconnect:", event, { terminalId, ...details });
      }
    };

    const clearReconnectTimer = () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const clearConnectTimer = () => {
      if (connectTimer !== null) {
        window.clearTimeout(connectTimer);
        connectTimer = null;
      }
    };

    const clearForegroundCoalesceTimer = () => {
      if (foregroundCoalesceTimer !== null) {
        window.clearTimeout(foregroundCoalesceTimer);
        foregroundCoalesceTimer = null;
      }
    };

    const sendResize = (size: TerminalSize) => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "resize", cols: size.cols, rows: size.rows }));
      }
    };
    sendResizeRef.current = sendResize;

    const closeActiveSocket = () => {
      const current = socket;
      socket = null;
      if (socketRef.current === current) {
        socketRef.current = null;
      }
      current?.close();
    };

    const writeTerminalData = (socketId: number, data: Uint8Array) => {
      if (
        disposed ||
        socketId !== socketGeneration ||
        rendererReadyRef.current?.generation !== ready.generation
      ) {
        return;
      }
      ready.renderer.write(data);
    };

    const connectSocket = (reason: ReconnectReason, connectTimeoutMs: number) => {
      if (disposed || reconnectStopped) {
        return;
      }
      clearConnectTimer();
      const initialSize = ready.measure();
      if (!initialSize) {
        scheduleReconnect("resize");
        return;
      }
      if (socket) {
        closeActiveSocket();
      }
      reconnectScheduledForSocket.clear();
      const currentSocketGeneration = socketGeneration + 1;
      socketGeneration = currentSocketGeneration;
      const nextSocket = new WebSocket(
        terminalSocketUrl(
          wsUrl,
          terminalId,
          initialSize,
          terminalOutputCoalesceMs,
          terminalOutputGzipSupported(),
        ),
      );
      let gzipOutputAcknowledged = false;
      const outputDecoder = createTerminalOutputFrameDecoder(
        (output) => writeTerminalData(currentSocketGeneration, output),
        (error) => {
          lastCloseReason = "terminal output decompression failed";
          debugReconnect("output-decompression-failed", { error });
          if (socket === nextSocket) {
            nextSocket.close();
          }
        },
      );
      socket = nextSocket;
      socketRef.current = nextSocket;
      nextSocket.binaryType = "arraybuffer";
      socketStartedAt = performance.now();
      setConnectionState("connecting");
      debugReconnect("connect_start", { reason, socketGeneration, connectTimeoutMs });
      connectTimer = window.setTimeout(
        () => retryStalledConnect(nextSocket, currentSocketGeneration),
        connectTimeoutMs,
      );

      nextSocket.addEventListener("open", () => {
        if (disposed || socket !== nextSocket || socketGeneration !== currentSocketGeneration) {
          return;
        }
        clearConnectTimer();
        clearReconnectTimer();
        reconnectAttempts = 0;
        foregroundFastAttemptsRemaining = 0;
        reconnectScheduledForSocket.delete(currentSocketGeneration);
        lastCloseReason = null;
        terminalInputBlockedRef.current = false;
        setCloseReason(null);
        setHasAttachedForTerminal(true);
        setConnectionState("attached");
        debugReconnect("open", { socketGeneration: currentSocketGeneration });
        const size = ready.measure();
        if (size) {
          sendResize(size);
        }
        if (autoFocusRef.current) {
          window.setTimeout(() => ready.renderer.focus(), 0);
        }
        flushBatchedTerminalInput();
        flushQueuedTerminalInput();
      });
      nextSocket.addEventListener("message", (event) => {
        if (disposed || socket !== nextSocket || socketGeneration !== currentSocketGeneration) {
          return;
        }
        if (typeof event.data === "string") {
          if (isTerminalOutputGzipAcknowledgement(event.data)) {
            gzipOutputAcknowledged = true;
            return;
          }
          lastCloseReason = parseTerminalCloseReason(event.data) ?? lastCloseReason;
          return;
        }
        if (event.data instanceof ArrayBuffer) {
          // Terminal output only flows after a successful daemon attach, so
          // a transient attach-conflict streak is over.
          attachConflictRetries = 0;
          const output = new Uint8Array(event.data);
          if (gzipOutputAcknowledged) {
            void outputDecoder.enqueue(output);
          } else {
            writeTerminalData(currentSocketGeneration, output);
          }
        }
      });
      nextSocket.addEventListener("close", () => {
        outputDecoder.cancel();
        if (disposed || socket !== nextSocket || socketGeneration !== currentSocketGeneration) {
          return;
        }
        clearConnectTimer();
        if (socketRef.current === nextSocket) {
          socketRef.current = null;
        }
        socket = null;
        if (lastCloseReason) {
          console.warn("terminal websocket closed", lastCloseReason);
        }
        if (
          isTerminalAttachConflictClose(lastCloseReason) &&
          attachConflictRetries < MAX_TERMINAL_ATTACH_CONFLICT_RETRIES
        ) {
          // Usually a bridge restart or reattach racing the daemon's cleanup
          // of the previous connection; retry briefly before concluding a
          // genuine external client holds the attach.
          attachConflictRetries += 1;
          debugReconnect("attach-conflict-retry", { attempt: attachConflictRetries });
          scheduleSocketReconnect("close", currentSocketGeneration);
          return;
        }
        if (isNonRetryableTerminalClose(lastCloseReason)) {
          reconnectStopped = true;
          terminalInputBlockedRef.current = true;
          clearReconnectTimer();
          clearQueuedTerminalInput();
          setCloseReason(lastCloseReason);
          setConnectionState("closed");
          return;
        }
        scheduleSocketReconnect("close", currentSocketGeneration);
      });
      nextSocket.addEventListener("error", () => {
        if (disposed || socket !== nextSocket || socketGeneration !== currentSocketGeneration) {
          return;
        }
        clearConnectTimer();
        debugReconnect("error", { socketGeneration: currentSocketGeneration });
        scheduleSocketReconnect("error", currentSocketGeneration);
        nextSocket.close();
      });
    };

    const scheduleConnect = (
      reason: ReconnectReason,
      mode: TerminalReconnectMode,
      immediate: boolean,
    ) => {
      if (disposed || reconnectStopped) {
        return;
      }
      if (reconnectTimer !== null) {
        if (!immediate) {
          return;
        }
        clearReconnectTimer();
      }
      const policy = terminalReconnectPolicy({
        attempt: reconnectAttempts,
        mode,
        immediate,
        foregroundFastAttemptsRemaining,
      });
      reconnectAttempts = policy.nextAttempt;
      foregroundFastAttemptsRemaining = policy.nextForegroundFastAttemptsRemaining;
      setConnectionState("connecting");
      debugReconnect("scheduled", {
        reason,
        mode,
        delayMs: policy.delayMs,
        connectTimeoutMs: policy.connectTimeoutMs,
      });
      const run = () => {
        reconnectTimer = null;
        connectSocket(reason, policy.connectTimeoutMs);
      };
      if (policy.delayMs === 0) {
        run();
        return;
      }
      reconnectTimer = window.setTimeout(run, policy.delayMs);
    };

    function scheduleReconnect(reason: ReconnectReason) {
      const mode: TerminalReconnectMode =
        foregroundFastAttemptsRemaining > 0 ? "foreground" : "normal";
      scheduleConnect(reason, mode, false);
    }

    function scheduleSocketReconnect(reason: ReconnectReason, socketId: number) {
      if (reconnectScheduledForSocket.has(socketId)) {
        return;
      }
      reconnectScheduledForSocket.add(socketId);
      scheduleReconnect(reason);
    }

    function retryStalledConnect(stalledSocket: WebSocket, socketId: number) {
      if (
        disposed ||
        socket !== stalledSocket ||
        socketGeneration !== socketId ||
        stalledSocket.readyState !== WebSocket.CONNECTING
      ) {
        return;
      }
      debugReconnect("stalled", { socketGeneration: socketId });
      socket = null;
      if (socketRef.current === stalledSocket) {
        socketRef.current = null;
      }
      stalledSocket.close();
      scheduleSocketReconnect("stalled", socketId);
    }

    const processForegroundReconnect = (reason: ReconnectReason) => {
      if (reconnectStopped) {
        return;
      }
      const now = performance.now();
      lastForegroundReconnectAt = now;
      const reasons = Array.from(pendingForegroundReasons);
      pendingForegroundReasons.clear();
      debugReconnect("signal", { reason, reasons });
      const currentSocket = socket;
      if (currentSocket?.readyState === WebSocket.OPEN) {
        const size = ready.measure("refresh");
        if (size) {
          sendResize(size);
        }
        return;
      }
      if (
        currentSocket?.readyState === WebSocket.CONNECTING &&
        now - socketStartedAt < TERMINAL_FOREGROUND_CONNECT_TIMEOUT_MS
      ) {
        const socketId = socketGeneration;
        const remainingMs = Math.max(1, TERMINAL_FOREGROUND_CONNECT_TIMEOUT_MS - (now - socketStartedAt));
        clearConnectTimer();
        connectTimer = window.setTimeout(
          () => retryStalledConnect(currentSocket, socketId),
          remainingMs,
        );
        return;
      }
      reconnectAttempts = 0;
      foregroundFastAttemptsRemaining = TERMINAL_FOREGROUND_FAST_ATTEMPTS;
      clearReconnectTimer();
      if (currentSocket) {
        closeActiveSocket();
      }
      scheduleConnect(reason, "foreground", true);
    };

    const requestForegroundReconnect = (reason: ReconnectReason) => {
      if (reconnectStopped) {
        return;
      }
      pendingForegroundReasons.add(reason);
      const now = performance.now();
      const remainingCoalesceMs =
        TERMINAL_FOREGROUND_SIGNAL_COALESCE_MS - (now - lastForegroundReconnectAt);
      if (remainingCoalesceMs > 0) {
        debugReconnect("signal_coalesced", { reason });
        if (foregroundCoalesceTimer === null) {
          foregroundCoalesceTimer = window.setTimeout(() => {
            foregroundCoalesceTimer = null;
            processForegroundReconnect(reason);
          }, remainingCoalesceMs);
        }
        return;
      }
      clearForegroundCoalesceTimer();
      processForegroundReconnect(reason);
    };

    const requestReconnect = (reason: ReconnectReason) => {
      if (reconnectStopped) {
        return;
      }
      if (reason === "resume" || reason === "visible" || reason === "online") {
        requestForegroundReconnect(reason);
        return;
      }
      if (reason === "resize") {
        if (socket?.readyState === WebSocket.OPEN) {
          const size = ready.measure("refresh");
          if (size) {
            sendResize(size);
          }
          return;
        }
        if (socket?.readyState === WebSocket.CONNECTING) {
          return;
        }
        scheduleReconnect(reason);
        return;
      }
      scheduleConnect(reason, "normal", reason === "initial" || reason === "manual");
    };

    requestReconnectRef.current = requestReconnect;
    const removeNativeResumeHandler = addNativeResumeHandler(() => requestReconnect("resume"));
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        requestReconnect("visible");
      }
    };
    const handleOnline = () => requestReconnect("online");
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);

    requestReconnect("initial");

    return () => {
      disposed = true;
      removeNativeResumeHandler();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      requestReconnectRef.current = () => {};
      flushBatchedTerminalInput();
      batchedInputRef.current = emptyTerminalInputBatch();
      clearReconnectTimer();
      clearConnectTimer();
      clearForegroundCoalesceTimer();
      closeActiveSocket();
      sendResizeRef.current = () => {};
    };
  }, [
    connectionKey,
    clearQueuedTerminalInput,
    flushBatchedTerminalInput,
    flushQueuedTerminalInput,
    pane?.terminal_id,
    rendererReady,
    terminalOutputCoalesceMs,
    wsUrl,
  ]);

  useEffect(() => {
    if (resumeToken > 0) {
      requestReconnectRef.current("resume");
    }
  }, [resumeToken]);

  useEffect(() => {
    let overlayTimer: number | null = null;
    if (!pane || connectionState === "idle" || connectionState === "attached") {
      setShowConnectionOverlay(false);
      return;
    }
    const overlayDelayMs = terminalConnectionOverlayDelayMs(
      connectionState,
      hasAttachedForTerminal || delayConnectingOverlayRef.current,
    );
    if (overlayDelayMs > 0) {
      setShowConnectionOverlay(false);
      overlayTimer = window.setTimeout(() => {
        setShowConnectionOverlay(true);
      }, overlayDelayMs);
      return () => {
        if (overlayTimer !== null) {
          window.clearTimeout(overlayTimer);
        }
      };
    }
    setShowConnectionOverlay(true);
    return () => {
      if (overlayTimer !== null) {
        window.clearTimeout(overlayTimer);
      }
    };
  }, [connectionState, hasAttachedForTerminal, pane?.terminal_id]);

  useEffect(() => {
    rendererRef.current?.setTapFocusHandler(
      !mobileControls
        ? null
        : mobileTapTarget === "command-input"
          ? focusMobileCommandInput
          : focusTerminalKeyboardInput,
    );
  }, [focusMobileCommandInput, focusTerminalKeyboardInput, mobileControls, mobileTapTarget]);

  useEffect(() => {
    rendererRef.current?.setMobileTouchSelection(
      mobileControls ? mobileLongPressBehavior : "off",
      mobileControls ? handleMobileTerminalTouch : null,
      mobileTouchSelectionEndpointTimeoutMs,
    );
  }, [
    handleMobileTerminalTouch,
    mobileControls,
    mobileLongPressBehavior,
    mobileTouchSelectionEndpointTimeoutMs,
  ]);

  useEffect(() => {
    const size = rendererRef.current?.setFontSize(terminalFontSizePx);
    if (size) {
      sendResizeRef.current(size);
    }
  }, [terminalFontSizePx]);

  useEffect(() => {
    setMobileSelectionAction(null);
    rendererRef.current?.clearSelection();
  }, [connectionKey, pane?.terminal_id]);

  useEffect(() => {
    return () => {
      if (uploadStatusTimerRef.current !== null) {
        window.clearTimeout(uploadStatusTimerRef.current);
        uploadStatusTimerRef.current = null;
      }
      resolveUploadConflict(false, false);
    };
  }, []);

  useEffect(() => {
    if (refitToken === 0) {
      return;
    }
    resizeTerminal("refresh");
  }, [refitToken, resizeTerminal]);

  useEffect(() => {
    if (!mobileControls || !pane) {
      return;
    }
    const refit = () => {
      resizeTerminal("refresh");
    };
    const frame = window.requestAnimationFrame(refit);
    const timers = [80, 280, 520].map((delay) => window.setTimeout(refit, delay));
    return () => {
      window.cancelAnimationFrame(frame);
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
    };
  }, [mobileControls, pane?.terminal_id, resizeTerminal]);

  useEffect(() => {
    if (!mobileControls) {
      return;
    }
    // httpUrl() throws while the bridge runtime hasn't connected yet, which
    // happens routinely on first mount — don't let that escape the effect.
    let url: string;
    try {
      url = httpUrl("/api/mobile-mode");
    } catch {
      return;
    }
    let cancelled = false;
    fetch(url)
      .then((response) => (response.ok ? (response.json() as Promise<{ active?: boolean }>) : null))
      .then((payload) => {
        if (!cancelled && payload && typeof payload.active === "boolean") {
          setMobileModeActive(payload.active);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [mobileControls, httpUrl]);

  const toggleMobileMode = useCallback(() => {
    let url: string;
    try {
      url = httpUrl("/api/mobile-mode");
    } catch {
      return;
    }
    fetch(url, { method: "POST" })
      .then((response) => (response.ok ? (response.json() as Promise<{ active?: boolean }>) : null))
      .then((payload) => {
        if (payload && typeof payload.active === "boolean") {
          setMobileModeActive(payload.active);
        }
      })
      .catch(() => {});
  }, [httpUrl]);

  const sendTerminalInput = (data: string) => {
    sendTerminalInputData(data);
  };
  const uploadDisabled = !pane || uploading;

  const closeMobileSelectionActions = () => {
    setMobileSelectionAction(null);
    rendererRef.current?.clearSelection();
  };

  const openSelectionUrl = () => {
    if (!mobileSelectionAction) {
      return;
    }
    const url = openableHttpUrl(mobileSelectionAction.url);
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      void copyText(mobileSelectionAction.text, "Copied selection");
    }
    closeMobileSelectionActions();
  };

  const copySelectionText = (text: string, successMessage: string) => {
    closeMobileSelectionActions();
    void copyText(text, successMessage);
  };

  const openFilePicker = () => {
    if (!uploadDisabled) {
      fileInputRef.current?.click();
    }
  };

  const confirmUploadReplace = (error: UploadConflictError) =>
    new Promise<boolean>((resolve) => {
      const next = { name: error.name, path: error.path, resolve };
      uploadConflictRef.current = next;
      setUploadConflict(next);
    });

  function resolveUploadConflict(replace: boolean, updateState = true) {
    const pending = uploadConflictRef.current;
    uploadConflictRef.current = null;
    if (updateState) {
      setUploadConflict(null);
    }
    pending?.resolve(replace);
  }

  function confirmUploadConflictReplace() {
    resolveUploadConflict(true);
    focusPreferredInput();
  }

  const uploadAndInsert = async (files: UploadCandidate[]) => {
    if (files.length === 0 || !pane) {
      if (files.length > 0) {
        showUploadStatus("No pane selected", 3000);
      }
      return;
    }
    if (uploadInFlightRef.current) {
      showUploadStatus("Upload already in progress", 2500);
      return;
    }
    uploadInFlightRef.current = true;
    setUploading(true);
    const uploadConnectionKey = connectionKey;
    const uploadTerminalId = pane.terminal_id;
    const uploadFiles = files.slice(0, MAX_UPLOAD_FILES);
    const skippedCount = files.length - uploadFiles.length;
    showUploadStatus(
      `Uploading ${uploadFiles.length} file${uploadFiles.length === 1 ? "" : "s"}${
        skippedCount > 0 ? `; skipping ${skippedCount}` : ""
      }`,
    );
    try {
      const uploaded: UploadedFile[] = [];
      for (const file of uploadFiles) {
        uploaded.push(await uploadWithOverwritePrompt(httpUrl, file, confirmUploadReplace));
      }
      if (
        connectionKeyRef.current !== uploadConnectionKey ||
        terminalIdRef.current !== uploadTerminalId
      ) {
        showUploadStatus("Upload completed after terminal changed", 3000);
        return;
      }
      if (uploaded.length > 0) {
        if (enqueueTerminalInput([uploaded.map((file) => shellQuote(file.path)).join(" ")])) {
          showUploadStatus(
            `Uploaded ${uploaded.length} file${uploaded.length === 1 ? "" : "s"}${
              skippedCount > 0 ? `; skipped ${skippedCount}` : ""
            }`,
            2500,
          );
        }
      } else {
        showUploadStatus(null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed";
      showUploadStatus(message, 4500);
    } finally {
      uploadInFlightRef.current = false;
      setUploading(false);
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLElement>) => {
    const files = uploadCandidatesFromClipboard(event.clipboardData);
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void uploadAndInsert(files);
  };

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    const files = uploadCandidatesFromFileList(event.dataTransfer.files);
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void uploadAndInsert(files);
  };

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const files = uploadCandidatesFromFileList(event.target.files);
    event.target.value = "";
    if (files.length === 0) {
      showUploadStatus("No file selected", 2000);
      return;
    }
    showUploadStatus(`Selected ${files.length} file${files.length === 1 ? "" : "s"}`);
    void uploadAndInsert(files);
  };

  const enqueueTerminalInput = (parts: string[]) => {
    if (terminalInputBlockedRef.current) {
      showUploadStatus("Terminal detached", 2500);
      return false;
    }
    const filteredParts = parts.filter((part) => part.length > 0);
    if (filteredParts.length === 0) {
      return false;
    }
    inputQueueRef.current.push(...filteredParts);
    flushQueuedTerminalInput();
    return true;
  };

  return (
    <section
      ref={stageRef}
      className="terminal-stage"
      aria-label={accessibilityLabel}
      aria-current={selected ? "true" : undefined}
      onDragOverCapture={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
        }
      }}
      onDropCapture={handleDrop}
      onPasteCapture={handlePaste}
    >
      <div ref={hostRef} className="terminal-host" />
      {pane && terminalScreenReaderText ? (
        <div
          className="terminal-accessible-screen sr-only"
          role="region"
          tabIndex={-1}
          aria-label={`${accessibilityLabel} screen contents`}
          aria-live="off"
        >
          {accessibleScreen}
        </div>
      ) : null}
      <input
        ref={fileInputRef}
        className="terminal-file-input"
        id={uploadInputId}
        type="file"
        multiple
        disabled={uploadDisabled}
        onChange={handleFileInput}
      />
      {!pane ? <div className="terminal-overlay">No panes available</div> : null}
      {pane && showConnectionOverlay && connectionState !== "attached" ? (
        <div className="terminal-overlay">
          {terminalConnectionCopy(connectionState, closeReason, hasAttachedForTerminal)}
        </div>
      ) : null}
      {pane && (
        <div className="terminal-connection-panel">
          <ConnectionConflictCard terminalId={pane.terminal_id} httpUrl={httpUrl} />
        </div>
      )}
      {scrolledAwayFromPresent ? (
        <button className="terminal-jump-to-present" type="button" onClick={jumpToTerminalPresent}>
          <ChevronsDown size={14} aria-hidden="true" />
          Jump to present
        </button>
      ) : null}
      {uploadStatus ? (
        <div className="terminal-upload-status" role="status" aria-live="polite">
          {uploadStatus}
        </div>
      ) : null}
      {!mobileControls ? (
        <button
          className="terminal-upload-fab"
          type="button"
          aria-label="Upload file"
          title="Upload file"
          disabled={uploadDisabled}
          onClick={openFilePicker}
        >
          <Paperclip size={16} />
        </button>
      ) : null}
      {mobileControls ? (
        <MobileTerminalControls
          commandInputRef={mobileCommandInputRef}
          disabled={!pane || connectionState !== "attached"}
          uploadDisabled={uploadDisabled}
          expandingInput={mobileCommandExpandingInput}
          enterNewline={mobileCommandEnterNewline}
          controlsScalePercent={mobileControlsScalePercent}
          compactControls={mobileCompactControls}
          onCompactControlsChange={onMobileCompactControlsChange}
          mobileModeActive={mobileModeActive}
          onToggleMobileMode={toggleMobileMode}
          onControlsHeightChange={setMobileControlsHeight}
          onInput={sendTerminalInput}
          onTerminalFocus={() => rendererRef.current?.focusTextInput()}
          onUpload={openFilePicker}
          onStageCommand={(command) => enqueueTerminalInput([command])}
          onSubmitCommand={(command) => enqueueTerminalInput([command, "\r"])}
          onNextAgentPane={onNextAgentPane}
          pinned={pinned}
          onPaneCycle={onPaneCycle}
          onPaneCycleModeToggle={onPaneCycleModeToggle}
          paneCycleMode={paneCycleMode}
          onPrevAgentPane={onPrevAgentPane}
        />
      ) : null}
      {mobileSelectionAction ? (
        <MobileSelectionActions
          action={mobileSelectionAction}
          onOpen={openSelectionUrl}
          onCopyUrl={() => copySelectionText(mobileSelectionAction.url, "Copied URL")}
          onCopyText={() => copySelectionText(mobileSelectionAction.text, "Copied selection")}
          onClose={closeMobileSelectionActions}
        />
      ) : null}
      {uploadConflict ? (
        <ConfirmDialog
          title="Replace uploaded file?"
          message={uploadConflictMessage(uploadConflict)}
          confirmLabel="Replace"
          onCancel={() => resolveUploadConflict(false)}
          onConfirm={confirmUploadConflictReplace}
        />
      ) : null}
    </section>
  );
}

function MobileSelectionActions({
  action,
  onOpen,
  onCopyUrl,
  onCopyText,
  onClose,
}: {
  action: MobileSelectionAction;
  onOpen: () => void;
  onCopyUrl: () => void;
  onCopyText: () => void;
  onClose: () => void;
}) {
  const canCopyTextSeparately = action.text !== action.url;
  const stopInteraction = (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
  };
  return (
    <div
      className="terminal-selection-sheet"
      role="dialog"
      aria-label="Selected URL actions"
      onPointerDown={stopInteraction}
      onPointerUp={stopInteraction}
      onTouchStart={stopInteraction}
      onTouchEnd={stopInteraction}
      onMouseDown={stopInteraction}
      onMouseUp={stopInteraction}
      onClick={stopInteraction}
    >
      <div className="terminal-selection-url mono">{action.url}</div>
      <div className="terminal-selection-actions">
        <button type="button" className="btn btn-primary" onClick={onOpen}>
          <ExternalLink size={15} />
          Open
        </button>
        <button type="button" className="btn" onClick={onCopyUrl}>
          <Link size={15} />
          Copy URL
        </button>
        {canCopyTextSeparately ? (
          <button type="button" className="btn" onClick={onCopyText}>
            <Copy size={15} />
            Copy text
          </button>
        ) : null}
        <button type="button" className="icon-btn" aria-label="Close" title="Close" onClick={onClose}>
          <X size={15} />
        </button>
      </div>
    </div>
  );
}

export function MobileTerminalControls({
  commandInputRef,
  disabled,
  uploadDisabled,
  expandingInput,
  enterNewline,
  controlsScalePercent,
  compactControls,
  onCompactControlsChange,
  mobileModeActive,
  onToggleMobileMode,
  onControlsHeightChange,
  onInput,
  onTerminalFocus,
  onUpload,
  onStageCommand,
  onSubmitCommand,
  onNextAgentPane,
  onPrevAgentPane,
  pinned,
  onPaneCycle,
  onPaneCycleModeToggle,
  paneCycleMode,
}: {
  commandInputRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  disabled: boolean;
  uploadDisabled: boolean;
  expandingInput: boolean;
  enterNewline: boolean;
  controlsScalePercent: number;
  compactControls: boolean;
  onCompactControlsChange: (compact: boolean) => void;
  mobileModeActive: boolean;
  onToggleMobileMode: () => void;
  onControlsHeightChange: (heightPx: number | null) => void;
  onInput: (data: string) => void;
  onTerminalFocus: () => void;
  onUpload: () => void;
  onStageCommand: (command: string) => void;
  onSubmitCommand: (command: string) => void;
  onNextAgentPane: () => void;
  onPrevAgentPane: () => void;
  pinned: boolean;
  onPaneCycle: (direction: "next" | "prev") => void;
  onPaneCycleModeToggle: () => void;
  paneCycleMode: "pin" | "all";
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [value, setValue] = useState("");
  const [fieldKey, setFieldKey] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [ctrlLatch, setCtrlLatch] = useState(false);
  const setCommandInputNode = (node: HTMLInputElement | HTMLTextAreaElement | null) => {
    commandInputRef.current = node;
  };
  const clearCommandInput = () => {
    setValue("");
    const node = commandInputRef.current;
    if (node) {
      node.value = "";
      node.defaultValue = "";
    }
    setFieldKey((key) => key + 1);
  };
  // Tap cycles panes; hold toggles which pool it cycles through.
  const paneCyclePress = useLongPress(onPaneCycleModeToggle, () => onPaneCycle("next"));
  const submit = () => {
    const command = value;
    clearCommandInput();
    onSubmitCommand(command);
  };
  const stage = () => {
    if (value.length === 0) {
      return;
    }
    const command = value;
    clearCommandInput();
    onStageCommand(command);
  };
  const sendKey = (key: TerminalKey) => {
    onInput(ctrlLatch && key.ctrlData ? key.ctrlData : key.data);
    if (ctrlLatch) {
      setCtrlLatch(false);
    }
  };

  useLayoutEffect(() => {
    const node = commandInputRef.current;
    if (fieldKey > 0 && node) {
      node.value = "";
      node.defaultValue = "";
    }
  }, [commandInputRef, fieldKey]);

  useLayoutEffect(() => {
    if (expandingInput) {
      autosizeMobileCommandTextarea(commandInputRef.current);
    }
  }, [commandInputRef, controlsScalePercent, expandingInput, fieldKey, value]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) {
      onControlsHeightChange(null);
      return;
    }
    const report = () => onControlsHeightChange(root.getBoundingClientRect().height);
    report();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", report);
      return () => {
        window.removeEventListener("resize", report);
        onControlsHeightChange(null);
      };
    }
    const observer = new ResizeObserver(report);
    observer.observe(root);
    return () => {
      observer.disconnect();
      onControlsHeightChange(null);
    };
  }, [onControlsHeightChange]);

  const onCommandTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
      return;
    }
    if (
      event.key !== "Enter" ||
      enterNewline ||
      event.shiftKey ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    ) {
      return;
    }
    event.preventDefault();
    if (!disabled) {
      submit();
    }
  };

  return (
    <div
      ref={rootRef}
      className="terminal-mobile-controls"
      data-expanded={expanded ? "true" : "false"}
      data-pinned={pinned ? "true" : "false"}
    >
      {!compactControls ? (
        <>
          <div className="term-key-strip" aria-label="Common terminal keys">
            <div className="term-key-group" aria-label="Terminal quick keys">
              <button
                className="term-key"
                type="button"
                disabled={disabled}
                onClick={() => sendKey(ESC_KEY)}
              >
                {ESC_KEY.label}
              </button>
              <button
                className="term-key"
                type="button"
                data-active={ctrlLatch ? "true" : "false"}
                disabled={disabled}
                onClick={() => setCtrlLatch((active) => !active)}
              >
                Ctrl
              </button>
              {COMMON_KEYS.map((key) => (
                <button
                  key={key.label}
                  className="term-key"
                  type="button"
                  disabled={disabled}
                  onClick={() => sendKey(key)}
                >
                  {key.label}
                </button>
              ))}
              {QUICK_NUMBER_KEYS.map((key) => (
                <button
                  key={key.label}
                  className="term-key"
                  type="button"
                  disabled={disabled}
                  onClick={() => sendKey(key)}
                >
                  {key.label}
                </button>
              ))}
            </div>
            <div className="term-key-actions" aria-label="Terminal actions">
              <button
                className="term-key term-key-icon"
                type="button"
                aria-label={expanded ? "Hide special keys" : "Show special keys"}
                title={expanded ? "Hide keys" : "Keys"}
                data-active={expanded ? "true" : "false"}
                onClick={() => setExpanded((open) => !open)}
              >
                <Keyboard size={15} />
              </button>
              <button
                className="term-key term-key-icon"
                type="button"
                aria-label="Upload file"
                title="Upload"
                disabled={uploadDisabled}
                onClick={onUpload}
              >
                <Paperclip size={15} />
              </button>
              <button
                className="term-key term-key-icon"
                type="button"
                aria-label="Focus terminal keyboard"
                title="Terminal keyboard"
                disabled={disabled}
                onPointerDown={(event) => {
                  if (event.pointerType === "touch" || event.pointerType === "pen") {
                    event.preventDefault();
                    onTerminalFocus();
                  }
                }}
                onClick={onTerminalFocus}
              >
                <SquareTerminal size={15} />
              </button>
            </div>
          </div>

          {expanded ? (
            <div className="term-key-panel" aria-label="Special terminal keys">
              {SPECIAL_KEYS.map((key) => (
                <button
                  key={key.label}
                  className="term-key"
                  type="button"
                  disabled={disabled}
                  onClick={() => sendKey(key)}
                >
                  {key.label}
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      <form
        className="term-input-row"
        data-expanding={expandingInput ? "true" : "false"}
        onSubmit={(event) => {
          event.preventDefault();
          if (!disabled) {
            submit();
          }
        }}
      >
        <button
          className="term-key term-key-icon term-compact-toggle"
          type="button"
          aria-label={compactControls ? "Show terminal keys" : "Hide terminal keys"}
          title={compactControls ? "Show keys" : "Hide keys"}
          data-active={compactControls ? "false" : "true"}
          onClick={() => onCompactControlsChange(!compactControls)}
        >
          <Keyboard size={15} />
        </button>
        <button
          className="term-key term-key-icon term-mobile-mode-toggle"
          type="button"
          aria-label={mobileModeActive ? "Show Claude Code statusline" : "Hide Claude Code statusline"}
          title={mobileModeActive ? "Show statusline" : "Hide statusline"}
          data-active={mobileModeActive ? "true" : "false"}
          onClick={onToggleMobileMode}
        >
          <Smartphone size={15} />
        </button>
        <button
          className="term-key term-key-icon term-pin-cycle"
          type="button"
          aria-label="Next pane (hold to switch between pinned-only and all panes)"
          title={
            paneCycleMode === "pin"
              ? "Next pinned agent (hold to switch mode)"
              : "Next agent (hold to switch mode)"
          }
          data-cycle-mode={paneCycleMode}
          {...paneCyclePress}
        >
          <SkipForward size={15} />
        </button>
        <ParlayInput
            key={fieldKey}
            value={value}
            onValueChange={setValue}
            onVoiceSubmit={(text) => {
              onSubmitCommand(text);
              setValue("");
              setFieldKey((k) => k + 1);
            }}
            onNextAgent={onNextAgentPane}
            onPrevAgent={onPrevAgentPane}
            disabled={disabled}
            expandingInput={expandingInput}
            enterNewline={enterNewline}
            controlsScalePercent={controlsScalePercent}
            onKeyDown={onCommandTextareaKeyDown}
            inputRef={setCommandInputNode}
          />
        <button
          className="term-send term-stage-command"
          type="button"
          disabled={disabled || value.length === 0}
          aria-label="Stage command in terminal"
          title="Stage"
          onClick={stage}
        >
          <TextCursorInput size={16} />
        </button>
        <button
          className="term-send"
          type="submit"
          disabled={disabled}
          aria-label={value.length > 0 ? "Send command" : "Send enter"}
          title={value.length > 0 ? "Send" : "Enter"}
        >
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}

type TerminalKey = {
  label: string;
  data: string;
  ctrlData?: string;
};

const COMMON_KEYS: TerminalKey[] = [
  { label: "Tab", data: "\t" },
  { label: "C-c", data: "\x03" },
  { label: "C-d", data: "\x04" },
];

const ESC_KEY: TerminalKey = { label: "Esc", data: "\x1B" };

const QUICK_NUMBER_KEYS: TerminalKey[] = [
  { label: "1", data: "1" },
  { label: "2", data: "2" },
  { label: "3", data: "3" },
];

const SPECIAL_KEYS: TerminalKey[] = [
  { label: "←", data: "\x1B[D" },
  { label: "↑", data: "\x1B[A" },
  { label: "↓", data: "\x1B[B" },
  { label: "→", data: "\x1B[C" },
  { label: "S-Tab", data: "\x1B[Z" },
  { label: "Bksp", data: "\x7F" },
  { label: "Del", data: "\x1B[3~" },
  { label: "Home", data: "\x1B[H" },
  { label: "End", data: "\x1B[F" },
  { label: "PgUp", data: "\x1B[5~" },
  { label: "PgDn", data: "\x1B[6~" },
  { label: "C-l", data: "\x0C" },
  { label: "C-r", data: "\x12" },
  { label: "C-z", data: "\x1A" },
  { label: "/", data: "/", ctrlData: "\x1F" },
  { label: "|", data: "|" },
  { label: "~", data: "~" },
  { label: "-", data: "-" },
  { label: "_", data: "_" },
  { label: "'", data: "'" },
  { label: "\"", data: "\"" },
  { label: "[", data: "[" },
  { label: "]", data: "]" },
  { label: "{", data: "{" },
  { label: "}", data: "}" },
];

function terminalSocketUrl(
  wsUrl: (path: string, query?: URLSearchParams) => string,
  terminalId: string,
  size: TerminalSize,
  coalesceMs: number,
  requestGzipOutput: boolean,
) {
  // Detect device/client type
  const ua = navigator.userAgent.toLowerCase();
  let deviceType = "browser";
  let deviceName = "web";

  if (ua.includes("ipad")) {
    deviceType = "tablet";
    deviceName = "ipad";
  } else if (ua.includes("iphone")) {
    deviceType = "mobile";
    deviceName = "iphone";
  } else if (ua.includes("android")) {
    deviceType = ua.includes("tablet") ? "tablet" : "mobile";
    deviceName = "android";
  } else if (ua.includes("macintosh")) {
    deviceType = "desktop";
    deviceName = "mac";
  } else if (ua.includes("windows")) {
    deviceType = "desktop";
    deviceName = "windows";
  } else if (ua.includes("linux")) {
    deviceType = "desktop";
    deviceName = "linux";
  }

  const params = new URLSearchParams({
    terminal_id: terminalId,
    cols: String(size.cols),
    rows: String(size.rows),
    takeover: "false",
    coalesce_ms: String(coalesceMs),
    device_name: deviceName,
    device_type: deviceType,
    app_id: "herdr-web",
  });
  if (requestGzipOutput) {
    params.set("output_encoding", "gzip");
  }
  return wsUrl("/ws/terminal", params);
}

async function copyToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-10000px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    if (!document.execCommand("copy")) {
      throw new Error("execCommand copy failed");
    }
  } finally {
    textarea.remove();
  }
}

function uploadCandidatesFromFileList(files: FileList | null): UploadCandidate[] {
  if (!files) {
    return [];
  }
  return Array.from(files).map((file) => ({
    blob: file,
    name: file.name.trim() || null,
  }));
}

function uploadCandidatesFromClipboard(data: DataTransfer): UploadCandidate[] {
  const files: UploadCandidate[] = [];
  for (const item of Array.from(data.items)) {
    if (item.kind !== "file") {
      continue;
    }
    const file = item.getAsFile();
    if (!file) {
      continue;
    }
    files.push({
      blob: file,
      name: file.name.trim() || null,
    });
  }
  return files;
}

async function uploadWithOverwritePrompt(
  httpUrl: (path: string, query?: URLSearchParams) => string,
  file: UploadCandidate,
  confirmReplace: (error: UploadConflictError) => Promise<boolean>,
): Promise<UploadedFile> {
  try {
    return await uploadFile(httpUrl, file, false);
  } catch (error) {
    if (!(error instanceof UploadConflictError)) {
      throw error;
    }
    const replace = await confirmReplace(error);
    if (!replace) {
      throw new Error("Upload canceled");
    }
    return uploadFile(httpUrl, file, true);
  }
}

function uploadConflictMessage(conflict: UploadConflictState) {
  return conflict.path
    ? `${conflict.name} already exists at ${conflict.path}.`
    : `${conflict.name} already exists.`;
}

async function uploadFile(
  httpUrl: (path: string, query?: URLSearchParams) => string,
  file: UploadCandidate,
  overwrite: boolean,
): Promise<UploadedFile> {
  const params = new URLSearchParams();
  if (file.name) {
    params.set("name", file.name);
  }
  if (overwrite) {
    params.set("overwrite", "true");
  }
  const response = await fetch(httpUrl("/api/uploads", params), {
    method: "POST",
    headers: file.blob.type ? { "content-type": file.blob.type } : undefined,
    body: file.blob,
  });
  const payload = (await response.json().catch(() => ({}))) as {
    file?: UploadedFile;
    error?: string;
    name?: string;
    path?: string;
  };
  if (response.status === 409) {
    throw new UploadConflictError(
      typeof payload.name === "string" ? payload.name : file.name || "file",
      typeof payload.path === "string" ? payload.path : "",
    );
  }
  if (!response.ok || !payload.file) {
    throw new Error(payload.error || `Upload failed (${response.status})`);
  }
  return payload.file;
}

class UploadConflictError extends Error {
  constructor(
    readonly name: string,
    readonly path: string,
  ) {
    super(`file exists: ${path || name}`);
  }
}
