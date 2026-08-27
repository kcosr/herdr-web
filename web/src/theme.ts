export type Theme = "dark" | "light";

export const DEFAULT_THEME: Theme = "dark";

export function parseTheme(value: unknown): Theme {
  return value === "light" ? "light" : DEFAULT_THEME;
}

export function nextTheme(theme: Theme): Theme {
  return theme === "dark" ? "light" : "dark";
}

export const THEME_COLORS: Record<Theme, string> = {
  dark: "#11111b",
  light: "#dce0e8",
};

export function applyTheme(doc: Document, theme: Theme): void {
  doc.documentElement.dataset.theme = theme;
  doc.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme]);
}
