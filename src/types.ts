export const ERROR_CODES = ["CONFIG_ERROR", "INVALID_SETTINGS", "INVALID_METADATA", "DUPLICATE_NAME", "UNKNOWN_MODEL", "UNKNOWN_TOOL", "UNKNOWN_AGENT_TYPE", "CONTRIBUTOR_EXCLUDED", "UNSUPPORTED_ARGUMENT", "INTERNAL_ERROR"] as const;
export type RoleErrorCode = (typeof ERROR_CODES)[number];
export class RoleError extends Error {
  constructor(public readonly code: RoleErrorCode, message: string) { super(message); this.name = "RoleError"; }
}
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type ExtensionSettings = Record<string, JsonValue>;
export interface ModelSpec { provider: string; model: string; thinking?: ThinkingLevel }
export interface AgentResourceSelectors { skills?: readonly string[]; extensions?: readonly string[]; tools?: readonly string[] }
export interface AgentResourceSelectorSet { skills: readonly string[]; extensions: readonly string[]; tools?: readonly string[] }
export interface AgentResourceSelectorSources { global: AgentResourceSelectors; project: AgentResourceSelectors; role?: AgentResourceSelectors; call?: AgentResourceSelectors; defaults?: { global: AgentResourceSelectors; project: AgentResourceSelectors } }
export const CONTEXT_FILE_SCOPES = ["global", "project", "cwd"] as const;
export type ContextFileScope = (typeof CONTEXT_FILE_SCOPES)[number];
export function isContextFileScope(value: unknown): value is ContextFileScope { return CONTEXT_FILE_SCOPES.some((scope) => scope === value); }
export interface RoleProvenance { path: string; scope?: RoleSourceScope; owner?: string; priority?: number }
export interface AgentDefinition { prompt?: string; description?: string; model?: string; thinking?: NonNullable<ModelSpec["thinking"]>; tools?: readonly string[]; skills?: readonly string[]; extensions?: readonly string[]; overrideSystemPrompt?: boolean; contextFiles?: readonly ContextFileScope[]; extensionSettings?: Readonly<ExtensionSettings>; provenance?: RoleProvenance }
export type RoleDefinition = AgentDefinition;
export type ResourceSelectors = AgentResourceSelectors;
export type ResourceSelectorSources = AgentResourceSelectorSources;
export interface ExtensionMetadata { version: string; headline: string }
export type RoleSourceScope = "builtin" | "extension" | "global" | "project";
export interface RoleDirectoryRegistration { path: string; extension?: ExtensionMetadata; builtin?: true; scope?: RoleSourceScope; priority?: number; owner?: string }
export interface RoleSettings extends AgentResourceSelectors { modelAliases?: Readonly<Record<string, string>>; extensionSettings?: Readonly<ExtensionSettings> }
