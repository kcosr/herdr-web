// Cross-bridge fuzzy search over panes/tabs, for the pane search dialog.
// Matching is a simple ordered-subsequence scorer (consecutive runs and
// word-boundary starts score higher), not a dependency — good enough for
// short labels/paths and keeps this pure and easily unit-testable.
import type { PaneInfo } from "./types";

export type PaneSearchEntry = {
  bridgeId: string;
  bridgeLabel: string;
  pane: PaneInfo;
  path: string;
};

export type PaneSearchResult = PaneSearchEntry & { score: number };

function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  let score = 0;
  let consecutive = 0;
  let lastMatchIndex = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) {
      continue;
    }
    let charScore = 1;
    if (lastMatchIndex === ti - 1) {
      consecutive += 1;
      charScore += consecutive * 2;
    } else {
      consecutive = 0;
    }
    const prevChar = ti > 0 ? t[ti - 1] : "";
    if (ti === 0 || prevChar === " " || prevChar === "/" || prevChar === "-" || prevChar === "_") {
      charScore += 3;
    }
    score += charScore;
    lastMatchIndex = ti;
    qi += 1;
  }
  return qi === q.length ? score : null;
}

function searchableText(entry: PaneSearchEntry): string {
  return [
    entry.pane.label,
    entry.pane.title,
    entry.pane.agent,
    entry.pane.display_agent,
    entry.pane.cwd,
    entry.path,
    entry.bridgeLabel,
  ]
    .filter(Boolean)
    .join(" ");
}

export function searchPanes(query: string, entries: PaneSearchEntry[]): PaneSearchResult[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return entries.map((entry) => ({ ...entry, score: 0 }));
  }
  const results: PaneSearchResult[] = [];
  for (const entry of entries) {
    const score = fuzzyScore(trimmed, searchableText(entry));
    if (score !== null) {
      results.push({ ...entry, score });
    }
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}
