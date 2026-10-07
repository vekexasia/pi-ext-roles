import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { isContextFileScope, type ContextFileScope, type ExtensionSettings, type RoleSettings, type AgentResourceSelectors, type AgentResourceSelectorSources } from "./types.js";
import { canonicalPath } from "./paths.js";
import { deepFreeze, errorText, fail, isNodeError, jsonValue, object, resourcePatternHasMagic, validateModelAliases, validateResourcePattern, validExtensionNamespace, mergeExtensionSettings } from "./utils.js";
export function roleSettingsPath(agentDir = getAgentDir()): string { return join(agentDir, "pi-ext-roles", "settings.json"); }
export function roleProjectSettingsPath(cwd: string): string { return join(cwd, ".pi", "pi-ext-roles", "settings.json"); }
function normalizedResourcePath(value: string, settingsPath: string): string {
  // Built-in extensions are named `builtin:<name>`, not by a path.
  if (value === "*" || value.startsWith("builtin:")) return value;
  let expanded = value === "~" ? homedir() : value.startsWith("~/") || value.startsWith("~\\") ? join(homedir(), value.slice(2)) : value;
  if (expanded.startsWith("file://")) expanded = fileURLToPath(expanded);
  const resolved = resolve(dirname(settingsPath), expanded);
  if (expanded === "**" || expanded.startsWith("**/") || expanded.startsWith("**\\")) return expanded;
  if (resourcePatternHasMagic(expanded)) {
    const magicIndex = resolved.search(/[*?\x5b\x5d{}()]/);
    const separatorIndex = Math.max(resolved.lastIndexOf("/", magicIndex), resolved.lastIndexOf("\\", magicIndex));
    const rootBoundary = separatorIndex === 0 || (separatorIndex === 2 && /^[A-Za-z]:[\\/]/.test(resolved));
    const prefix = rootBoundary ? resolved.slice(0, separatorIndex + 1) : separatorIndex >= 0 ? resolved.slice(0, separatorIndex) : resolved;
    const suffix = rootBoundary ? resolved.slice(separatorIndex + 1) : separatorIndex >= 0 ? resolved.slice(separatorIndex) : "";
    return `${canonicalPath(prefix)}${suffix}`;
  }
  return canonicalPath(resolved);
}
export function validateSelectorList(value: unknown, path: string, kind: "skills" | "extensions" | "tools", errorCode: "INVALID_SETTINGS" | "INVALID_METADATA" = "INVALID_SETTINGS", normalizeExtensions = true): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) fail(errorCode, `${path}.${kind} must be an array`);
  const normalized: string[] = [];
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "string" || !entry.trim()) fail(errorCode, `${path}.${kind}[${String(index)}] must be a non-empty string`);
    let selector = entry.trim();
    if (kind === "extensions" && normalizeExtensions) {
      const negated = selector.startsWith("!");
      const body = negated ? selector.slice(1) : selector;
      if (!body) fail(errorCode, `${path}.${kind}[${String(index)}] must be a valid minimatch pattern: Empty minimatch pattern ${JSON.stringify(selector)}`);
      try { selector = `${negated ? "!" : ""}${normalizedResourcePath(body, path)}`; } catch (error) { fail(errorCode, `${path}.${kind}[${String(index)}] must be a valid path: ${errorText(error)}`); }
    }
    try { validateResourcePattern(selector); } catch (error) { fail(errorCode, `${path}.${kind}[${String(index)}] must be a valid minimatch pattern: ${errorText(error)}`); }
    normalized.push(selector);
  }
  return Object.freeze(normalized);
}
export function validateContextFileScopes(value: unknown, rolePath: string): readonly ContextFileScope[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every(isContextFileScope)) fail("INVALID_METADATA", `${rolePath}.contextFiles must be an array containing only global, project, or cwd`);
  return [...value];
}
export function validateExtensionSettings(value: unknown, path: string, code: "INVALID_SETTINGS" | "INVALID_METADATA" = "INVALID_SETTINGS"): ExtensionSettings | undefined {
  if (value === undefined) return undefined;
  if (!object(value)) fail(code, `${path}.extensionSettings must be an object`);
  for (const [namespace, raw] of Object.entries(value)) {
    if (!validExtensionNamespace(namespace)) fail(code, `${path}.extensionSettings contains an invalid namespace: ${namespace}`);
    if (!jsonValue(raw)) fail(code, `${path}.extensionSettings.${namespace} must be JSON-compatible`);
  }
  return deepFreeze(structuredClone(value) as ExtensionSettings);
}
export function loadSettings(path = roleSettingsPath()): Readonly<RoleSettings> {
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { if (isNodeError(error, "ENOENT")) return Object.freeze({}); fail("INVALID_SETTINGS", `${path}: ${errorText(error)}`); }
  if (!object(raw)) fail("INVALID_SETTINGS", `${path} must be an object`);
  for (const key of Object.keys(raw)) if (!["modelAliases", "tools", "skills", "extensions", "extensionSettings"].includes(key)) fail("INVALID_SETTINGS", `${path}: unknown setting ${key}`);
  const result: RoleSettings = {};
  for (const kind of ["tools", "skills", "extensions"] as const) {
    const selectors = validateSelectorList(raw[kind], path, kind);
    if (selectors !== undefined) result[kind] = selectors;
  }
  if (raw.modelAliases !== undefined) result.modelAliases = validateModelAliases(raw.modelAliases, path);
  const extensionSettings = validateExtensionSettings(raw.extensionSettings, path);
  if (extensionSettings !== undefined) result.extensionSettings = extensionSettings;
  return deepFreeze(result);
}
export function resolveRoleSettings(cwd: string, projectTrusted: boolean, globalSettingsPath = roleSettingsPath()) {
  const projectSettingsPath = roleProjectSettingsPath(cwd);
  const global = loadSettings(globalSettingsPath);
  const project = projectTrusted ? loadSettings(projectSettingsPath) : Object.freeze({}) as Readonly<RoleSettings>;
  const has = (key: keyof RoleSettings) => Object.prototype.hasOwnProperty.call(project, key);
  const effective: RoleSettings = { ...global, ...project };
  for (const kind of ["skills", "extensions", "tools"] as const) if (global[kind] !== undefined || project[kind] !== undefined) effective[kind] = [...(global[kind] ?? []), ...(project[kind] ?? [])];
  effective.extensionSettings = mergeExtensionSettings(global.extensionSettings, project.extensionSettings);
  const sources = Object.fromEntries(["modelAliases", "skills", "extensions", "tools", "extensionSettings"].map(key => [key, has(key as keyof RoleSettings) ? projectSettingsPath : globalSettingsPath]));
  return { globalSettingsPath, projectSettingsPath, projectTrusted, global, project, effective: deepFreeze(effective), sources };
}
function selectors(settings: RoleSettings): AgentResourceSelectors {
  return Object.fromEntries(["skills", "extensions", "tools"].flatMap(key => settings[key as keyof AgentResourceSelectors] === undefined ? [] : [[key, settings[key as keyof AgentResourceSelectors]]])) as AgentResourceSelectors;
}
type RoleConfigurationOptions = { cwd: string; agentDir?: string; projectTrusted?: boolean; settingsPath?: string; selectorSources?: AgentResourceSelectorSources; modelAliases?: Readonly<Record<string, string>>; useSharedSettings?: boolean };
type RoleConfiguration = { settings: ReturnType<typeof resolveRoleSettings> | undefined; selectorSources: AgentResourceSelectorSources; modelAliases: Readonly<Record<string, string>> };
export function composeRoleConfiguration(options: RoleConfigurationOptions & { useSharedSettings: false }): RoleConfiguration & { settings: undefined };
export function composeRoleConfiguration(options: RoleConfigurationOptions & { useSharedSettings?: true }): RoleConfiguration & { settings: ReturnType<typeof resolveRoleSettings> };
export function composeRoleConfiguration(options: RoleConfigurationOptions): RoleConfiguration;
export function composeRoleConfiguration(options: RoleConfigurationOptions): RoleConfiguration {
  if (options.useSharedSettings === false) return { settings: undefined, selectorSources: options.selectorSources ?? { global: {}, project: {} }, modelAliases: options.modelAliases ?? {} };
  const settings = resolveRoleSettings(options.cwd, options.projectTrusted ?? true, options.settingsPath ?? roleSettingsPath(options.agentDir));
  const shared = { global: selectors(settings.global), project: selectors(settings.project) };
  const hasSharedSelectors = Object.values(shared).some(layer => Object.keys(layer).length > 0);
  const selectorSources: AgentResourceSelectorSources = options.selectorSources === undefined ? shared : {
    ...options.selectorSources,
    ...(hasSharedSelectors ? { defaults: shared } : {}),
  };
  return { settings, selectorSources, modelAliases: { ...settings.effective.modelAliases, ...options.modelAliases } };
}
