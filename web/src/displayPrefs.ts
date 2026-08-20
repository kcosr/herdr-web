export const DEFAULT_CONTENT_INSET_TOP_PX = 0;
export const DEFAULT_CONTENT_INSET_BOTTOM_PX = 0;
export const DEFAULT_MOBILE_CONTROLS_SCALE_PERCENT = 100;
export const DEFAULT_AGENT_FEATURES_IN_TABS = true;
export const DEFAULT_MULTI_HOST_SPACE_SELECTION = true;

export const MIN_CONTENT_INSET_TOP_PX = 0;
export const MAX_CONTENT_INSET_TOP_PX = 96;
export const MIN_CONTENT_INSET_BOTTOM_PX = 0;
export const MAX_CONTENT_INSET_BOTTOM_PX = 160;
export const MIN_MOBILE_CONTROLS_SCALE_PERCENT = 80;
export const MAX_MOBILE_CONTROLS_SCALE_PERCENT = 150;

export function parseContentInsetTopPx(value: unknown) {
  return parseClampedInteger(
    value,
    MIN_CONTENT_INSET_TOP_PX,
    MAX_CONTENT_INSET_TOP_PX,
    DEFAULT_CONTENT_INSET_TOP_PX,
  );
}

export function parseContentInsetBottomPx(value: unknown) {
  return parseClampedInteger(
    value,
    MIN_CONTENT_INSET_BOTTOM_PX,
    MAX_CONTENT_INSET_BOTTOM_PX,
    DEFAULT_CONTENT_INSET_BOTTOM_PX,
  );
}

export function parseMobileControlsScalePercent(value: unknown) {
  return parseClampedInteger(
    value,
    MIN_MOBILE_CONTROLS_SCALE_PERCENT,
    MAX_MOBILE_CONTROLS_SCALE_PERCENT,
    DEFAULT_MOBILE_CONTROLS_SCALE_PERCENT,
  );
}

export function parseAgentFeaturesInTabs(
  value: unknown,
  fallback = DEFAULT_AGENT_FEATURES_IN_TABS,
) {
  return typeof value === "boolean" ? value : fallback;
}

export function parseMultiHostSpaceSelection(
  value: unknown,
  fallback = DEFAULT_MULTI_HOST_SPACE_SELECTION,
) {
  return typeof value === "boolean" ? value : fallback;
}

function parseClampedInteger(value: unknown, min: number, max: number, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}
