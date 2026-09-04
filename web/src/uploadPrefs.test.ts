import { describe, expect, it } from "vitest";

import {
  DEFAULT_AUTO_RENAME_UPLOAD_CONFLICTS,
  parseAutoRenameUploadConflicts,
} from "./uploadPrefs";

describe("upload preferences", () => {
  it("defaults automatic conflict renaming on", () => {
    expect(DEFAULT_AUTO_RENAME_UPLOAD_CONFLICTS).toBe(true);
    expect(parseAutoRenameUploadConflicts(undefined)).toBe(true);
  });

  it("preserves stored Boolean choices and rejects other shapes", () => {
    expect(parseAutoRenameUploadConflicts(false)).toBe(false);
    expect(parseAutoRenameUploadConflicts(true, false)).toBe(true);
    expect(parseAutoRenameUploadConflicts("false", false)).toBe(false);
  });
});
