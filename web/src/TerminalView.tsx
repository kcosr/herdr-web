import {
  Copy,
  ExternalLink,
  Keyboard,
  Link,
  Paperclip,
  Send,
  SquareTerminal,
  TextCursorInput,
  X,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent, ClipboardEvent, DragEvent, RefObject } from "react";
import { ConfirmDialog } from "./overlays";
import { shellQuote } from "./shell";
import { findFirstUrlInSelection, openableHttpUrl } from "./terminalSelection";
import { GhosttyRenderer } from "./terminalRenderer";
import type { TerminalRenderer, TerminalSize } from "./terminalRenderer";
import type { MobileTerminalTapTarget } from "./mobileTerminalPrefs";
import type { PaneInfo } from "./types";

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
  /** Where terminal taps should send focus on mobile. */
  mobileTapTarget?: MobileTerminalTapTarget;
  /** Enables long-press drag selection on touch terminals. */
  mobileTouchSelection?: boolean;
  /** Incrementing token from the parent that requests an immediate fit+resize. */
  refitToken?: number;
  /** Incrementing token from the parent that requests focus on the preferred terminal input. */
  focusToken?: number;
};

type ConnectionState = "idle" | "connecting" | "attached" | "closed" | "error";
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

const MAX_UPLOAD_FILES = 8;
const TERMINAL_CONNECT_TIMEOUT_MS = 3500;

export function TerminalView({
  pane,
  connectionKey,
  resumeToken,
  httpUrl,
  wsUrl,
  autoFocus = true,
  scrollSensitivity = 1,
  mobileControls = false,
  mobileTapTarget = "command-input",
  mobileTouchSelection = false,
  refitToken = 0,
  focusToken = 0,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mobileCommandInputRef = useRef<HTMLInputElement | null>(null);
  const rendererRef = useRef<TerminalRenderer | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const uploadInputId = useId();
  const sendResizeRef = useRef<(size: TerminalSize) => void>(() => {});
  const inputQueueRef = useRef<string[]>([]);
  const inputFlushTimerRef = useRef<number | null>(null);
  const uploadStatusTimerRef = useRef<number | null>(null);
  const uploadInFlightRef = useRef(false);
  const uploadConflictRef = useRef<UploadConflictState | null>(null);
  const connectionKeyRef = useRef(connectionKey);
  const terminalIdRef = useRef(pane?.terminal_id ?? null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [closeReason, setCloseReason] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadConflict, setUploadConflict] = useState<UploadConflictState | null>(null);
  const [mobileSelectionAction, setMobileSelectionAction] =
    useState<MobileSelectionAction | null>(null);
  // Read at attach time without re-running the effect (which would re-attach the socket).
  const autoFocusRef = useRef(autoFocus);
  autoFocusRef.current = autoFocus;
  const scrollSensitivityRef = useRef(scrollSensitivity);
  scrollSensitivityRef.current = scrollSensitivity;
  const mobileControlsRef = useRef(mobileControls);
  mobileControlsRef.current = mobileControls;
  const mobileTapTargetRef = useRef(mobileTapTarget);
  mobileTapTargetRef.current = mobileTapTarget;
  const mobileTouchSelectionRef = useRef(mobileTouchSelection);
  mobileTouchSelectionRef.current = mobileTouchSelection;
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

  const handleMobileSelection = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      setMobileSelectionAction(null);
      if (!trimmed) {
        return;
      }
      const url = findFirstUrlInSelection(trimmed);
      if (url) {
        setMobileSelectionAction({ text: trimmed, url });
        return;
      }
      void copyText(trimmed, "Copied selection");
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
    if (!host || !pane) {
      setConnectionState("idle");
      return;
    }

    host.replaceChildren();
    let disposed = false;
    let socket: WebSocket | null = null;
    let disposeInput: (() => void) | null = null;
    let disposeScroll: (() => void) | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let reconnectTimer: number | null = null;
    let connectTimer: number | null = null;
    let reconnectAttempts = 0;
    let lastCloseReason: string | null = null;
    const renderer: TerminalRenderer = new GhosttyRenderer();
    rendererRef.current = renderer;
    setConnectionState("connecting");

    const sendResize = (size: TerminalSize) => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "resize", cols: size.cols, rows: size.rows }));
      }
    };
    sendResizeRef.current = sendResize;

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
          mobileControlsRef.current && mobileTouchSelectionRef.current,
          handleMobileSelection,
        );

        disposeInput = renderer.onInput((data) => {
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "input", data }));
          }
        });
        disposeScroll = renderer.onScroll((lines) => {
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
        });

        resizeObserver = new ResizeObserver(() => {
          const size = measureTerminal(renderer);
          if (size) {
            sendResize(size);
          }
        });
        resizeObserver.observe(host);

        const fontReady = document.fonts?.ready;
        if (fontReady) {
          void fontReady.then(() => {
            if (!disposed) {
              const size = measureTerminal(renderer, "refresh");
              if (size) {
                sendResize(size);
              }
            }
          });
        }

        const scheduleReconnect = () => {
          if (disposed || reconnectTimer !== null) {
            return;
          }
          const delay = Math.min(500 * 2 ** reconnectAttempts, 5000);
          reconnectAttempts += 1;
          setConnectionState("connecting");
          reconnectTimer = window.setTimeout(() => {
            reconnectTimer = null;
            connectSocket();
          }, delay);
        };

        const clearConnectTimer = () => {
          if (connectTimer !== null) {
            window.clearTimeout(connectTimer);
            connectTimer = null;
          }
        };

        const retryStalledConnect = (stalledSocket: WebSocket) => {
          if (
            disposed ||
            socket !== stalledSocket ||
            stalledSocket.readyState !== WebSocket.CONNECTING
          ) {
            return;
          }
          socket = null;
          if (socketRef.current === stalledSocket) {
            socketRef.current = null;
          }
          stalledSocket.close();
          scheduleReconnect();
        };

        const connectSocket = () => {
          if (disposed) {
            return;
          }
          clearConnectTimer();
          const initialSize = measureTerminal(renderer);
          if (!initialSize) {
            scheduleReconnect();
            return;
          }
          const nextSocket = new WebSocket(
            terminalSocketUrl(wsUrl, pane.terminal_id, initialSize),
          );
          socket = nextSocket;
          socketRef.current = nextSocket;
          nextSocket.binaryType = "arraybuffer";
          connectTimer = window.setTimeout(
            () => retryStalledConnect(nextSocket),
            TERMINAL_CONNECT_TIMEOUT_MS,
          );

          nextSocket.addEventListener("open", () => {
            if (!disposed && socket === nextSocket) {
              clearConnectTimer();
              reconnectAttempts = 0;
              lastCloseReason = null;
              setCloseReason(null);
              setConnectionState("attached");
              const size = measureTerminal(renderer);
              if (size) {
                sendResize(size);
              }
              if (autoFocusRef.current) {
                window.setTimeout(() => renderer.focus(), 0);
              }
            }
          });
          nextSocket.addEventListener("message", (event) => {
            if (typeof event.data === "string") {
              lastCloseReason = parseCloseReason(event.data) ?? lastCloseReason;
              return;
            }
            if (event.data instanceof ArrayBuffer) {
              renderer.write(new Uint8Array(event.data));
              return;
            }
            if (event.data instanceof Blob) {
              void event.data.arrayBuffer().then((buffer) => {
                if (!disposed && socket === nextSocket) {
                  renderer.write(new Uint8Array(buffer));
                }
              });
            }
          });
          nextSocket.addEventListener("close", () => {
            if (!disposed && socket === nextSocket) {
              clearConnectTimer();
              if (lastCloseReason) {
                console.warn("terminal websocket closed", lastCloseReason);
              }
              if (isNonRetryableAttachClose(lastCloseReason)) {
                setCloseReason(lastCloseReason);
                setConnectionState("closed");
              } else {
                scheduleReconnect();
              }
            }
          });
          nextSocket.addEventListener("error", () => {
            if (!disposed && socket === nextSocket) {
              clearConnectTimer();
              setConnectionState("error");
            }
          });
        };

        connectSocket();
      })
      .catch((error: unknown) => {
        console.error("failed to mount terminal renderer", error);
        if (!disposed) {
          setConnectionState("error");
        }
      });

    return () => {
      disposed = true;
      inputQueueRef.current = [];
      if (inputFlushTimerRef.current !== null) {
        window.clearTimeout(inputFlushTimerRef.current);
        inputFlushTimerRef.current = null;
      }
      disposeInput?.();
      disposeScroll?.();
      resizeObserver?.disconnect();
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (connectTimer !== null) {
        window.clearTimeout(connectTimer);
        connectTimer = null;
      }
      socket?.close();
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
      sendResizeRef.current = () => {};
      renderer.dispose();
      rendererRef.current = null;
      host.replaceChildren();
    };
  }, [connectionKey, measureTerminal, pane?.terminal_id, resumeToken, wsUrl]);

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
      mobileControls && mobileTouchSelection,
      handleMobileSelection,
    );
  }, [handleMobileSelection, mobileControls, mobileTouchSelection]);

  useEffect(() => {
    setMobileSelectionAction(null);
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

  const sendTerminalInput = (data: string) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "input", data }));
    }
  };
  const uploadDisabled = !pane || uploading;

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
    setMobileSelectionAction(null);
  };

  const copySelectionText = (text: string, successMessage: string) => {
    setMobileSelectionAction(null);
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
        enqueueTerminalInput([uploaded.map((file) => shellQuote(file.path)).join(" ")]);
        showUploadStatus(
          `Uploaded ${uploaded.length} file${uploaded.length === 1 ? "" : "s"}${
            skippedCount > 0 ? `; skipped ${skippedCount}` : ""
          }`,
          2500,
        );
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
    inputQueueRef.current.push(...parts.filter((part) => part.length > 0));
    if (inputFlushTimerRef.current !== null) {
      return;
    }
    let retryCount = 0;
    const flush = () => {
      inputFlushTimerRef.current = null;
      const socket = socketRef.current;
      if (socket?.readyState !== WebSocket.OPEN) {
        if (inputQueueRef.current.length > 0 && retryCount < 80) {
          retryCount += 1;
          inputFlushTimerRef.current = window.setTimeout(flush, 125);
        }
        return;
      }
      retryCount = 0;
      const next = inputQueueRef.current.shift();
      if (next !== undefined) {
        socket.send(JSON.stringify({ type: "input", data: next }));
      }
      if (inputQueueRef.current.length > 0) {
        inputFlushTimerRef.current = window.setTimeout(flush, 35);
      }
    };
    inputFlushTimerRef.current = window.setTimeout(flush, 0);
  };

  return (
    <section
      className="terminal-stage"
      aria-label="Selected pane terminal"
      onDragOverCapture={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
        }
      }}
      onDropCapture={handleDrop}
      onPasteCapture={handlePaste}
    >
      <div ref={hostRef} className="terminal-host" />
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
      {pane && connectionState !== "attached" ? (
        <div className="terminal-overlay">{connectionCopy(connectionState, closeReason)}</div>
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
          onInput={sendTerminalInput}
          onTerminalFocus={() => rendererRef.current?.focusTextInput()}
          onUpload={openFilePicker}
          onStageCommand={(command) => enqueueTerminalInput([command])}
          onSubmitCommand={(command) => enqueueTerminalInput([command, "\r"])}
        />
      ) : null}
      {mobileSelectionAction ? (
        <MobileSelectionActions
          action={mobileSelectionAction}
          onOpen={openSelectionUrl}
          onCopyUrl={() => copySelectionText(mobileSelectionAction.url, "Copied URL")}
          onCopyText={() => copySelectionText(mobileSelectionAction.text, "Copied selection")}
          onClose={() => {
            setMobileSelectionAction(null);
          }}
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

function MobileTerminalControls({
  commandInputRef,
  disabled,
  uploadDisabled,
  onInput,
  onTerminalFocus,
  onUpload,
  onStageCommand,
  onSubmitCommand,
}: {
  commandInputRef: RefObject<HTMLInputElement | null>;
  disabled: boolean;
  uploadDisabled: boolean;
  onInput: (data: string) => void;
  onTerminalFocus: () => void;
  onUpload: () => void;
  onStageCommand: (command: string) => void;
  onSubmitCommand: (command: string) => void;
}) {
  const [value, setValue] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [ctrlLatch, setCtrlLatch] = useState(false);
  const submit = () => {
    onSubmitCommand(value);
    setValue("");
  };
  const stage = () => {
    if (value.length === 0) {
      return;
    }
    onStageCommand(value);
    setValue("");
  };
  const sendKey = (key: TerminalKey) => {
    onInput(ctrlLatch && key.ctrlData ? key.ctrlData : key.data);
    if (ctrlLatch) {
      setCtrlLatch(false);
    }
  };

  return (
    <div className="terminal-mobile-controls" data-expanded={expanded ? "true" : "false"}>
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

      <form
        className="term-input-row"
        onSubmit={(event) => {
          event.preventDefault();
          if (!disabled) {
            submit();
          }
        }}
      >
        <input
          ref={commandInputRef}
          className="term-native-input mono"
          type="text"
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="send"
          disabled={disabled}
          value={value}
          onChange={(event) => setValue(event.target.value)}
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
) {
  const params = new URLSearchParams({
    terminal_id: terminalId,
    cols: String(size.cols),
    rows: String(size.rows),
    takeover: "false",
  });
  return wsUrl("/ws/terminal", params);
}

function parseCloseReason(message: string) {
  try {
    const parsed = JSON.parse(message) as { type?: unknown; reason?: unknown };
    return parsed.type === "closed" && typeof parsed.reason === "string" ? parsed.reason : null;
  } catch {
    return null;
  }
}

function isNonRetryableAttachClose(reason: string | null) {
  return (
    reason?.includes("already has an attached client") ||
    reason?.includes("terminal attach taken over") ||
    reason?.includes("terminal attach failed: terminal")
  );
}

function connectionCopy(state: ConnectionState, reason: string | null) {
  if (reason?.includes("already has an attached client")) {
    return "Attached elsewhere";
  }
  if (reason?.includes("terminal attach taken over")) {
    return "Detached elsewhere";
  }
  switch (state) {
    case "connecting":
      return "Connecting";
    case "closed":
      return "Detached";
    case "error":
      return "Connection failed";
    case "idle":
    case "attached":
      return "";
  }
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
