import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
export function canonicalPath(path: string): string {
  const absolute = resolve(path);
  try { return realpathSync(absolute); } catch { return absolute; }
}

/** Pi names built-in extensions `builtin:<name>` instead of by a path; other extensions are files, possibly given as file: URLs. */
export function extensionIdentity(path: string): string { return path.startsWith("builtin:") ? path : canonicalPath(path.startsWith("file:") ? fileURLToPath(path) : path); }

export function sameFilesystemPath(left: string, right: string): boolean { return canonicalPath(left) === canonicalPath(right); }
