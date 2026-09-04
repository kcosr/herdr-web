export const DEFAULT_AUTO_RENAME_UPLOAD_CONFLICTS = true;

export function parseAutoRenameUploadConflicts(
  value: unknown,
  fallback = DEFAULT_AUTO_RENAME_UPLOAD_CONFLICTS,
) {
  return typeof value === "boolean" ? value : fallback;
}
