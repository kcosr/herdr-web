/** Mutable dimensions used to resize the expanding mobile command textarea. */
export interface MobileCommandTextareaAutosizeTarget {
  scrollHeight: number;
  clientHeight?: number;
  offsetHeight?: number;
  style: {
    height: string;
  };
}

/** Sizes the expanding mobile command textarea to its wrapped content. */
export function autosizeMobileCommandTextarea(
  textarea: MobileCommandTextareaAutosizeTarget | null,
) {
  if (!textarea) {
    return;
  }
  textarea.style.height = "auto";
  const borderHeight =
    typeof textarea.offsetHeight === "number" && typeof textarea.clientHeight === "number"
      ? Math.max(0, textarea.offsetHeight - textarea.clientHeight)
      : 0;
  textarea.style.height = `${textarea.scrollHeight + borderHeight}px`;
}

type MobileTerminalModifier = "ctrl" | "shift" | "alt";

interface MobileTerminalModifierOption {
  id: MobileTerminalModifier;
  label: string;
}

/** Canonical modifier order and labels for the mobile terminal chord composer. */
export const MOBILE_TERMINAL_MODIFIERS: readonly MobileTerminalModifierOption[] = [
  { id: "ctrl", label: "Ctrl" },
  { id: "shift", label: "Shift" },
  { id: "alt", label: "Alt" },
];

interface MobileTerminalLiteralEncoding {
  kind: "literal";
  data: string;
  codepoint: number;
  shiftedData?: string;
}

interface MobileTerminalCsiFinalEncoding {
  kind: "csi-final";
  data: string;
  finalByte: string;
}

interface MobileTerminalCsiTildeEncoding {
  kind: "csi-tilde";
  data: string;
  parameter: number;
}

interface MobileTerminalPrintableEncoding {
  kind: "printable";
  value: string;
}

type MobileTerminalChordEncoding =
  | MobileTerminalLiteralEncoding
  | MobileTerminalCsiFinalEncoding
  | MobileTerminalCsiTildeEncoding
  | MobileTerminalPrintableEncoding;

/** One printable or special key that can complete a mobile terminal chord. */
export interface MobileTerminalChordKey {
  id: string;
  name: string;
  label: string;
  encoding: MobileTerminalChordEncoding;
}

/** Special terminal keys available in the mobile chord composer. */
export const MOBILE_TERMINAL_SPECIAL_KEYS: readonly MobileTerminalChordKey[] = [
  {
    id: "escape",
    name: "Escape",
    label: "Esc",
    encoding: { kind: "literal", data: "\x1B", codepoint: 27 },
  },
  {
    id: "tab",
    name: "Tab",
    label: "Tab",
    encoding: { kind: "literal", data: "\t", codepoint: 9, shiftedData: "\x1B[Z" },
  },
  {
    id: "backspace",
    name: "Backspace",
    label: "Bksp",
    encoding: { kind: "literal", data: "\x7F", codepoint: 127 },
  },
  {
    id: "arrow-left",
    name: "Left",
    label: "←",
    encoding: { kind: "csi-final", data: "\x1B[D", finalByte: "D" },
  },
  {
    id: "arrow-up",
    name: "Up",
    label: "↑",
    encoding: { kind: "csi-final", data: "\x1B[A", finalByte: "A" },
  },
  {
    id: "arrow-down",
    name: "Down",
    label: "↓",
    encoding: { kind: "csi-final", data: "\x1B[B", finalByte: "B" },
  },
  {
    id: "arrow-right",
    name: "Right",
    label: "→",
    encoding: { kind: "csi-final", data: "\x1B[C", finalByte: "C" },
  },
  {
    id: "home",
    name: "Home",
    label: "Home",
    encoding: { kind: "csi-final", data: "\x1B[H", finalByte: "H" },
  },
  {
    id: "end",
    name: "End",
    label: "End",
    encoding: { kind: "csi-final", data: "\x1B[F", finalByte: "F" },
  },
  {
    id: "delete",
    name: "Delete",
    label: "Del",
    encoding: { kind: "csi-tilde", data: "\x1B[3~", parameter: 3 },
  },
  {
    id: "page-up",
    name: "Page Up",
    label: "PgUp",
    encoding: { kind: "csi-tilde", data: "\x1B[5~", parameter: 5 },
  },
  {
    id: "page-down",
    name: "Page Down",
    label: "PgDn",
    encoding: { kind: "csi-tilde", data: "\x1B[6~", parameter: 6 },
  },
];

/** Creates one printable key for the mobile terminal chord composer. */
export function mobileTerminalPrintableKey(value: string): MobileTerminalChordKey {
  if (Array.from(value).length !== 1) {
    throw new Error("Mobile terminal chord printable key must contain exactly one character");
  }
  const label = value === " " ? "Space" : value;
  return {
    id: `printable-${value}`,
    name: label,
    label,
    encoding: { kind: "printable", value },
  };
}

/** Formats one mobile terminal chord for its visible preview and accessible name. */
export function formatMobileTerminalChord(
  key: MobileTerminalChordKey,
  modifiers: readonly MobileTerminalModifier[],
) {
  const labels = MOBILE_TERMINAL_MODIFIERS
    .filter((modifier) => modifiers.includes(modifier.id))
    .map((modifier) => modifier.label);
  return [...labels, key.label].join(" + ");
}

/** Encodes one mobile terminal key chord as VT input bytes. */
export function encodeMobileTerminalChord(
  key: MobileTerminalChordKey,
  modifiers: readonly MobileTerminalModifier[],
): string {
  const uniqueModifiers = new Set(modifiers);
  const { encoding } = key;
  if (encoding.kind === "printable") {
    return encodePrintableTerminalChord(encoding.value, uniqueModifiers);
  }
  if (encoding.kind === "literal") {
    if (uniqueModifiers.size === 0) {
      return encoding.data;
    }
    if (
      uniqueModifiers.size === 1
      && uniqueModifiers.has("shift")
      && encoding.shiftedData
    ) {
      return encoding.shiftedData;
    }
    return `\x1B[27;${xtermModifierParameter(uniqueModifiers)};${encoding.codepoint}~`;
  }
  if (uniqueModifiers.size === 0) {
    return encoding.data;
  }

  const modifierParameter = xtermModifierParameter(uniqueModifiers);
  if (encoding.kind === "csi-final") {
    return `\x1B[1;${modifierParameter}${encoding.finalByte}`;
  }
  return `\x1B[${encoding.parameter};${modifierParameter}~`;
}

function encodePrintableTerminalChord(
  value: string,
  modifiers: ReadonlySet<MobileTerminalModifier>,
) {
  let data = modifiers.has("shift") ? shiftedPrintableKey(value) : value;
  if (modifiers.has("ctrl")) {
    data = controlCharacterForPrintableKey(data);
  }
  return modifiers.has("alt") ? `\x1B${data}` : data;
}

function shiftedPrintableKey(value: string) {
  if (/^[a-z]$/i.test(value)) {
    return value.toUpperCase();
  }
  switch (value) {
    case "1": return "!";
    case "2": return "@";
    case "3": return "#";
    case "4": return "$";
    case "5": return "%";
    case "6": return "^";
    case "7": return "&";
    case "8": return "*";
    case "9": return "(";
    case "0": return ")";
    case "-": return "_";
    case "=": return "+";
    case "[": return "{";
    case "]": return "}";
    case "\\": return "|";
    case ";": return ":";
    case "'": return "\"";
    case ",": return "<";
    case ".": return ">";
    case "/": return "?";
    case "`": return "~";
    default: return value;
  }
}

function controlCharacterForPrintableKey(value: string) {
  const uppercase = value.toUpperCase();
  if (/^[A-Z]$/.test(uppercase)) {
    return String.fromCharCode(uppercase.charCodeAt(0) - 64);
  }
  switch (value) {
    case " ":
    case "@":
    case "2":
      return "\x00";
    case "[":
    case "3":
      return "\x1B";
    case "\\":
    case "4":
      return "\x1C";
    case "]":
    case "5":
      return "\x1D";
    case "^":
    case "6":
      return "\x1E";
    case "_":
    case "-":
    case "/":
    case "7":
      return "\x1F";
    case "?":
    case "8":
      return "\x7F";
    default:
      return value;
  }
}

function xtermModifierParameter(modifiers: ReadonlySet<MobileTerminalModifier>) {
  return 1
    + (modifiers.has("shift") ? 1 : 0)
    + (modifiers.has("alt") ? 2 : 0)
    + (modifiers.has("ctrl") ? 4 : 0);
}
