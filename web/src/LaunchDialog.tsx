import { Terminal } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { AgentIcon, agentIconKindFromHint } from "./AgentIcon";
import { launchPresetLabel } from "./launch";
import type { LaunchSpec, LaunchTarget } from "./launch";
import type { LauncherPresetOption } from "./launcherPresets";
import { trapFocusWithin, useFocusReturn } from "./overlayFocus";

export function LaunchDialog({
  target,
  busy,
  options,
  emptyMessage,
  onCancel,
  onSubmit,
}: {
  target: LaunchTarget;
  busy?: boolean;
  options: readonly LauncherPresetOption[];
  emptyMessage?: string | null;
  onCancel: () => void;
  onSubmit: (spec: LaunchSpec) => void;
}) {
  const firstOption = options[0] ?? null;
  const [presetId, setPresetId] = useState(firstOption?.id ?? "");
  const [title, setTitle] = useState(() => firstOption?.label ?? "");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const selectedLabelRef = useRef(firstOption?.label ?? "");
  const titleId = useId();
  useFocusReturn();

  const matchedOption = options.find((option) => option.id === presetId) ?? null;
  const selectedOption = matchedOption ?? firstOption;
  if (matchedOption) {
    selectedLabelRef.current = matchedOption.label;
  }

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    if (options.length === 0 || matchedOption) {
      return;
    }
    const next = options[0];
    const previousLabel = selectedLabelRef.current;
    setPresetId(next.id);
    setTitle((current) => {
      const trimmed = current.trim();
      return trimmed === "" || trimmed === previousLabel ? next.label : current;
    });
    selectedLabelRef.current = next.label;
  }, [matchedOption, options]);

  const choosePreset = (nextPresetId: string) => {
    setTitle((current) => {
      const trimmed = current.trim();
      return trimmed === "" || trimmed === launchPresetLabel(presetId, options)
        ? launchPresetLabel(nextPresetId, options)
        : current;
    });
    setPresetId(nextPresetId);
  };

  const chooseAndFocusPreset = (nextPresetId: string) => {
    choosePreset(nextPresetId);
    window.requestAnimationFrame(() => {
      const button = optionRefs.current.get(nextPresetId);
      button?.focus();
      button?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) {
      return;
    }
    const trimmed = title.trim();
    if (trimmed && selectedOption) {
      onSubmit({ presetId, label: selectedOption.label, title: trimmed });
    }
  };

  return (
    <div className="overlay-root">
      <button
        className="overlay-scrim"
        type="button"
        tabIndex={-1}
        aria-label="Cancel"
        onClick={onCancel}
      />
      <form
        className="modal launch-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={submit}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
            return;
          }
          trapFocusWithin(event);
        }}
      >
        <div id={titleId} className="modal-title">
          {launchTitle(target)}
        </div>
        <div className="launch-grid" role="radiogroup" aria-label="Launch type">
          {options.length === 0 ? (
            <div className="launch-empty mono" role="status">
              {emptyMessage ?? "No launcher presets available."}
            </div>
          ) : (
            options.map((option, index) => (
              <button
                key={option.id}
                ref={(button) => {
                  if (button) {
                    optionRefs.current.set(option.id, button);
                  } else {
                    optionRefs.current.delete(option.id);
                  }
                }}
                type="button"
                className="launch-option"
                role="radio"
                aria-checked={presetId === option.id}
                data-active={presetId === option.id}
                disabled={busy}
                tabIndex={presetId === option.id ? 0 : -1}
                onClick={() => choosePreset(option.id)}
                onKeyDown={(event) => {
                  if (
                    event.key !== "ArrowRight" &&
                    event.key !== "ArrowDown" &&
                    event.key !== "ArrowLeft" &&
                    event.key !== "ArrowUp" &&
                    event.key !== "Home" &&
                    event.key !== "End"
                  ) {
                    return;
                  }
                  event.preventDefault();
                  const lastIndex = options.length - 1;
                  const nextIndex =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? lastIndex
                        : event.key === "ArrowRight" || event.key === "ArrowDown"
                          ? index === lastIndex
                            ? 0
                            : index + 1
                          : index === 0
                            ? lastIndex
                            : index - 1;
                  chooseAndFocusPreset(options[nextIndex].id);
                }}
              >
                <LaunchOptionIcon option={option} />
                <span>{option.label}</span>
              </button>
            ))
          )}
        </div>
        <label className="field-label">
          <span>title</span>
          <input
            ref={inputRef}
            className="field"
            value={title}
            placeholder={selectedOption?.label ?? ""}
            disabled={busy}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || !title.trim() || options.length === 0}
          >
            Create
          </button>
        </div>
      </form>
    </div>
  );
}

function LaunchOptionIcon({ option }: { option: LauncherPresetOption }) {
  const kind = agentIconKindFromHint(option.agent_hint);
  if (kind) {
    return <AgentIcon kind={kind} />;
  }
  return <Terminal size={15} />;
}

function launchTitle(target: LaunchTarget) {
  if (target.mode === "tab") {
    return "New tab";
  }
  return target.direction === "right" ? "Split right" : "Split down";
}
