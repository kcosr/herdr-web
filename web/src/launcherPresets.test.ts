import { describe, expect, it } from "vitest";
import {
  parseLauncherPresetsResponse,
  supportsLauncherPresets,
} from "./launcherPresets";

describe("launcher presets", () => {
  it("detects bridge support from capabilities", () => {
    expect(supportsLauncherPresets({ commands: [], launcher_presets: { version: 1 } })).toBe(true);
    expect(supportsLauncherPresets({ commands: [] })).toBe(false);
    expect(supportsLauncherPresets(null)).toBe(false);
  });

  it("parses preset responses and warnings", () => {
    expect(
      parseLauncherPresetsResponse({
        version: 1,
        presets: [
          {
            id: "remote-codex",
            label: "Remote Codex",
            agent_hint: "codex",
            built_in: false,
          },
        ],
        warnings: ["bad preset omitted"],
      }),
    ).toEqual({
      version: 1,
      presets: [
        {
          id: "remote-codex",
          label: "Remote Codex",
          agent_hint: "codex",
          built_in: false,
        },
      ],
      warnings: ["bad preset omitted"],
    });
  });

  it("rejects malformed responses instead of inventing launcher options", () => {
    expect(() => parseLauncherPresetsResponse({})).toThrow("invalid launcher presets response");
    expect(() =>
      parseLauncherPresetsResponse({
        version: 1,
        presets: [{ id: "builtin:codex", label: "Codex", built_in: true }],
        warnings: [],
      }),
    ).toThrow("invalid launcher preset");
  });

  it("preserves an intentionally empty preset list", () => {
    expect(
      parseLauncherPresetsResponse({
        version: 1,
        presets: [],
        warnings: [],
      }),
    ).toEqual({
      version: 1,
      presets: [],
      warnings: [],
    });
  });
});
