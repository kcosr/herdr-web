// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { installTerminalImeFocusRedirect } from "./terminalImeFocus";

afterEach(() => {
  document.body.replaceChildren();
});

describe("terminal IME focus redirect", () => {
  it("restores the textarea after terminal selection focuses the host", () => {
    const container = document.createElement("div");
    container.tabIndex = 0;
    const textarea = document.createElement("textarea");
    container.append(textarea);
    document.body.append(container);
    const cleanup = installTerminalImeFocusRedirect({
      container,
      textarea,
      hasAlternateTapFocus: () => false,
      focusTextarea: () => textarea.focus(),
    });

    textarea.focus();
    expect(document.activeElement).toBe(textarea);
    container.focus();
    expect(document.activeElement).toBe(textarea);

    cleanup();
  });

  it("does not steal focus when mobile uses an alternate tap target", () => {
    const container = document.createElement("div");
    container.tabIndex = 0;
    const textarea = document.createElement("textarea");
    container.append(textarea);
    document.body.append(container);
    const cleanup = installTerminalImeFocusRedirect({
      container,
      textarea,
      hasAlternateTapFocus: () => true,
      focusTextarea: () => textarea.focus(),
    });

    container.focus();
    expect(document.activeElement).toBe(container);

    cleanup();
  });
});
