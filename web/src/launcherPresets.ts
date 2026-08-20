import type { BridgeCapabilities } from "./bridge";
import type { BridgeHttpUrl } from "./bridgeApi";
import { fetchWithTimeout } from "./fetchWithTimeout";

export type LauncherPresetOption = {
  id: string;
  label: string;
  agent_hint: string | null;
  built_in: boolean;
};

export type LauncherPresetsResponse = {
  version: 1;
  presets: LauncherPresetOption[];
  warnings: string[];
};

export function supportsLauncherPresets(capabilities: BridgeCapabilities | null | undefined) {
  return capabilities?.launcher_presets?.version === 1;
}

export async function fetchLauncherPresets(
  httpUrl: BridgeHttpUrl,
): Promise<LauncherPresetsResponse> {
  const response = await fetchWithTimeout(httpUrl("/api/launcher-presets"));
  if (!response.ok) {
    throw new Error(`launcher presets failed: ${response.status}`);
  }
  return parseLauncherPresetsResponse(await response.json());
}

export function parseLauncherPresetsResponse(value: unknown): LauncherPresetsResponse {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !Array.isArray(value.presets) ||
    !Array.isArray(value.warnings) ||
    !value.warnings.every((warning) => typeof warning === "string")
  ) {
    throw new Error("invalid launcher presets response");
  }
  const presets = value.presets.map(parseLauncherPreset);
  return {
    version: 1,
    presets,
    warnings: value.warnings,
  };
}

function parseLauncherPreset(value: unknown): LauncherPresetOption {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.label !== "string" ||
    (value.agent_hint !== null && typeof value.agent_hint !== "string") ||
    typeof value.built_in !== "boolean"
  ) {
    throw new Error("invalid launcher preset");
  }
  return {
    id: value.id,
    label: value.label,
    agent_hint: value.agent_hint,
    built_in: value.built_in,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
