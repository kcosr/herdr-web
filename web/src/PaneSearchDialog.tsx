import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AgentIcon, agentIconKind } from "./AgentIcon";
import { searchPanes } from "./paneSearch";
import type { PaneSearchEntry, PaneSearchResult } from "./paneSearch";
import { paneTitle } from "./state";

export function PaneSearchDialog({
  entries,
  onCancel,
  onSelect,
}: {
  entries: PaneSearchEntry[];
  onCancel: () => void;
  onSelect: (bridgeId: string, pane: PaneSearchEntry["pane"]) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const resultRefs = useRef(new Map<number, HTMLButtonElement>());

  const results = useMemo(() => searchPanes(query, entries), [query, entries]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    resultRefs.current.get(activeIndex)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const choose = (result: PaneSearchResult) => {
    onSelect(result.bridgeId, result.pane);
  };

  return (
    <div className="overlay-root">
      <button className="overlay-scrim" type="button" aria-label="Cancel" onClick={onCancel} />
      <div
        className="modal pane-search-modal"
        role="dialog"
        aria-modal="true"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onCancel();
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((current) => (results.length === 0 ? 0 : (current + 1) % results.length));
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((current) =>
              results.length === 0 ? 0 : (current - 1 + results.length) % results.length,
            );
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            const result = results[activeIndex];
            if (result) {
              choose(result);
            }
          }
        }}
      >
        <div className="modal-title">Search panes</div>
        <label className="field-label pane-search-field">
          <Search size={15} aria-hidden="true" />
          <input
            ref={inputRef}
            className="field"
            value={query}
            placeholder="Fuzzy search by label, agent, cwd, workspace/tab..."
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="pane-search-results" role="listbox" aria-label="Matching panes">
          {results.length === 0 ? (
            <div className="launch-empty mono" role="status">
              No matching panes.
            </div>
          ) : (
            results.map((result, index) => {
              const kind = agentIconKind(result.pane);
              return (
                <button
                  key={`${result.bridgeId}:${result.pane.pane_id}`}
                  ref={(button) => {
                    if (button) {
                      resultRefs.current.set(index, button);
                    } else {
                      resultRefs.current.delete(index);
                    }
                  }}
                  type="button"
                  className="pane-search-result"
                  role="option"
                  aria-selected={index === activeIndex}
                  data-active={index === activeIndex}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(result)}
                >
                  {kind ? <AgentIcon kind={kind} /> : <Search size={15} aria-hidden="true" />}
                  <span className="pane-search-result-text">
                    <span className="pane-search-result-title">{paneTitle(result.pane)}</span>
                    <span className="pane-search-result-path">
                      {result.bridgeLabel} &middot; {result.path}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
