export type Theme = "dark" | "light";

export const DEFAULT_THEME: Theme = "dark";

export function parseTheme(value: unknown): Theme {
  return value === "light" ? "light" : DEFAULT_THEME;
}

export function nextTheme(theme: Theme): Theme {
  return theme === "dark" ? "light" : "dark";
}
