import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { EventBus, ExtensionAPI, LoadExtensionsResult } from "@earendil-works/pi-coding-agent";
import type { RoleDirectoryRegistration, ExtensionMetadata } from "./types.js";
import { canonicalPath, extensionIdentity } from "./paths.js";
import { deepFreeze, fail, object } from "./utils.js";

export const ROLE_COLLECTION_CHANNEL = "pi-ext-roles:collect:v1";
export interface RoleContribution {
  active?: true;
  owner: string;
  directories: readonly RoleDirectoryRegistration[];
}
export interface RoleCollectionRequest { activeOnly?: boolean; reply(contribution: RoleContribution): void }
export interface RegisterRoleContributionOptions {
  owner: string | URL;
  roleDirectories: readonly (string | URL | RoleDirectoryRegistration)[];
  extension?: ExtensionMetadata;
}
export function registerRoleContribution(api: Pick<ExtensionAPI, "events"> & Partial<Pick<ExtensionAPI, "on">>, options: RegisterRoleContributionOptions): () => void {
  const owner = extensionIdentity(options.owner instanceof URL || options.owner.startsWith("file:") ? fileURLToPath(options.owner) : options.owner);
  const directories = options.roleDirectories.map(value => {
    const source = typeof value === "string" || value instanceof URL ? { path: value instanceof URL ? fileURLToPath(value) : value } : value;
    if (typeof source.path !== "string" || !source.path.trim()) fail("INVALID_METADATA", "Role directory path must be a non-empty string");
    if (source.scope !== undefined && !["builtin", "extension", "global", "project"].includes(source.scope)) fail("INVALID_METADATA", `Invalid role source scope: ${source.scope}`);
    if (source.priority !== undefined && !Number.isFinite(source.priority)) fail("INVALID_METADATA", "Role source priority must be finite");
    return { ...source, path: canonicalPath(resolve(dirname(owner), source.path)), owner, scope: source.scope ?? "extension", ...(options.extension === undefined ? {} : { extension: options.extension }) };
  });
  const contribution = deepFreeze({ owner, directories });
  let active = false;
  let disposed = false;
  const unsubscribeStart = api.on?.("session_start", () => { if (!disposed) active = true; });
  const unsubscribeShutdown = api.on?.("session_shutdown", () => { active = false; });
  const unsubscribe = api.events.on(ROLE_COLLECTION_CHANNEL, request => {
    if (object(request) && typeof request.reply === "function" && (!request.activeOnly || active)) request.reply(request.activeOnly ? { ...contribution, active: true } : contribution);
  });
  return () => { disposed = true; active = false; unsubscribeStart?.(); unsubscribeShutdown?.(); unsubscribe(); };
}
export function collectRoleContributions(bus: Pick<EventBus, "emit">, membership: readonly string[] | LoadExtensionsResult | { activeOnly: true }): readonly RoleDirectoryRegistration[] {
  const activeOnly = !Array.isArray(membership) && "activeOnly" in membership;
  const owners = new Set((activeOnly ? [] : Array.isArray(membership) ? membership : (membership as LoadExtensionsResult).extensions.map(e => e.resolvedPath)).map(extensionIdentity));
  const seen = new Set<string>();
  const result: RoleDirectoryRegistration[] = [];
  let collecting = true;
  let contributionError: unknown;
  const request: RoleCollectionRequest = { activeOnly, reply(value) {
    if (!collecting) return;
    try {
      if (!object(value) || typeof value.owner !== "string" || !Array.isArray(value.directories)) fail("INVALID_METADATA", "Invalid role contribution");
      if (activeOnly && value.active !== true) return;
      const owner = extensionIdentity(value.owner);
      if (!activeOnly && !owners.has(owner)) return;
      for (const source of value.directories) {
        if (!object(source) || typeof source.path !== "string") fail("INVALID_METADATA", "Invalid contributed directory");
        if (source.owner !== undefined && extensionIdentity(String(source.owner)) !== owner) fail("INVALID_METADATA", "Role contribution owner mismatch");
        if (source.scope !== undefined && !["builtin", "extension", "global", "project"].includes(String(source.scope))) fail("INVALID_METADATA", "Invalid contributed scope");
        if (source.priority !== undefined && (typeof source.priority !== "number" || !Number.isFinite(source.priority))) fail("INVALID_METADATA", "Invalid contributed priority");
        const normalized = { ...source, path: canonicalPath(source.path), owner } as RoleDirectoryRegistration;
        const key = JSON.stringify([owner, normalized.path, normalized.scope ?? "extension", normalized.priority ?? 0]);
        if (seen.has(key)) continue;
        seen.add(key); result.push(normalized);
      }
    } catch (error) { contributionError = error; }
  } };
  try { bus.emit(ROLE_COLLECTION_CHANNEL, request); }
  finally { collecting = false; }
  if (contributionError) throw contributionError;
  return deepFreeze(result.sort((a, b) => a.path.localeCompare(b.path) || (a.owner ?? "").localeCompare(b.owner ?? "")));
}
