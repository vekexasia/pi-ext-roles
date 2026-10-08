import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { collectRoleContributions } from "./contributions.js";
import { isPackagedFallbackRole, loadRole, resolveRole } from "./roles.js";
import { composeRoleConfiguration, validateExtensionSettings } from "./settings.js";
import { RoleError, type AgentResourceSelectorSources, type ContextFileScope, type ExtensionSettings, type ModelSpec } from "./types.js";
import { fail, mergeExtensionSettings, object } from "./utils.js";

// Structural boundary keeps the independent library/CLI free of workflow imports.
export interface AgentPreparation {
  label?: string;
  model?: string;
  tools: string[];
  skills: string[];
  extensions: string[];
  contextFiles?: ContextFileScope[];
  systemPrompt?: string;
  systemPromptAppend: string;
  settings: Readonly<ExtensionSettings>;
}
export interface AgentPreparationContext {
  readonly options: Readonly<{
    label?: string;
    model?: string;
    tools?: readonly string[];
    skills?: readonly string[];
    extensions?: readonly string[];
    contextFiles?: readonly ContextFileScope[];
    [key: string]: unknown;
  }>;
  readonly cwd: string;
  readonly projectCwd?: string;
  readonly agentDir: string;
  readonly projectTrusted: boolean;
  readonly defaults: Readonly<{
    model: ModelSpec;
    modelAliases: Readonly<Record<string, string>>;
    dynamicModelAliasNames?: readonly string[];
    selectorSources: AgentResourceSelectorSources;
    settings: Readonly<ExtensionSettings>;
  }>;
  readonly capabilities: Readonly<{
    tools: readonly string[];
    skills: readonly string[];
    extensions: readonly string[];
  }>;
  readonly knownModels: ReadonlySet<string>;
  readonly availableModels: ReadonlySet<string>;
  readonly signal: AbortSignal;
  readonly mode: "execution" | "inspection";
}
// Root dynamic < shared static < consumer static. Without dynamic metadata every consumer alias keeps precedence.
function layeredModelAliases(consumer: Readonly<Record<string, string>>, shared: Readonly<Record<string, string>>, dynamicNames: readonly string[] | undefined): Readonly<Record<string, string>> {
  if (dynamicNames === undefined) return { ...shared, ...consumer };
  if (!Array.isArray(dynamicNames) || !dynamicNames.every(name => typeof name === "string")) fail("CONFIG_ERROR", "dynamicModelAliasNames must be an array of strings");
  const dynamic = new Set(dynamicNames);
  const entries = Object.entries(consumer);
  return { ...Object.fromEntries(entries.filter(([name]) => dynamic.has(name))), ...shared, ...Object.fromEntries(entries.filter(([name]) => !dynamic.has(name))) };
}
/** `source` is the module URL of the Pi extension entry that calls this, so consumers can prove the hook's extension loaded. */
export function registerWorkflowRoles(api: Pick<ExtensionAPI, "events">, registry: {
  registerWorkflowExtension(extension: {
    version: string;
    headline: string;
    source?: string;
    agentPreparationHooks: Readonly<Record<string, {
      optionsSchema: { type: "object"; properties: { role: { type: "string"; minLength: number }; systemPrompt: Record<string, never>; systemPromptAppend: Record<string, never>; extensionSettings: Record<string, never> }; additionalProperties: true };
      prepare(configuration: AgentPreparation, context: Readonly<AgentPreparationContext>): void;
    }>>;
  }): void;
}, source?: string): void {
  const manifest: unknown = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  if (!object(manifest) || typeof manifest.version !== "string") fail("INVALID_METADATA", "Roles manifest requires a version");
  function prepareWorkflowRole(configuration: AgentPreparation, context: Readonly<AgentPreparationContext>): void {
    context.signal.throwIfAborted();
    if (typeof context.projectTrusted !== "boolean") fail("CONFIG_ERROR", "Workflow roles require an explicit project trust decision");
    const options = context.options;
    if (options.role !== undefined && typeof options.role !== "string") fail("INVALID_METADATA", "Invalid role name: expected a string");
    // Role files and shared settings belong to the launch project; cwd stays the execution directory for selectors.
    if (context.projectCwd !== undefined && typeof context.projectCwd !== "string") fail("CONFIG_ERROR", "Workflow role projectCwd must be a string");
    const projectCwd = context.projectCwd ?? context.cwd;
    const composed = composeRoleConfiguration({ cwd: projectCwd, agentDir: context.agentDir, projectTrusted: context.projectTrusted,
      selectorSources: context.defaults.selectorSources });
    const modelAliases = layeredModelAliases(context.defaults.modelAliases, composed.modelAliases, context.defaults.dynamicModelAliasNames);
    const callSettings = validateExtensionSettings(options.extensionSettings, "agent options");
    const extensionRoleDirectories = collectRoleContributions(api.events, { activeOnly: true });
    const definition = options.role === undefined ? undefined
      : loadRole(options.role, { cwd: projectCwd, agentDir: context.agentDir, projectTrusted: context.projectTrusted, extensionRoleDirectories });
    // Packaged fallback roles stay model-free; only workflow consumers default them to a present `<role>-model` alias.
    const builtinAlias = options.model === undefined && definition?.model === undefined && isPackagedFallbackRole(definition)
      && Object.hasOwn(modelAliases, `${options.role}-model`) ? `${options.role}-model` : undefined;
    const resolved = resolveRole(options.role, {
      cwd: context.cwd, agentDir: context.agentDir, projectTrusted: context.projectTrusted,
      ...(definition === undefined ? {} : { definition }),
      useSharedSettings: false, selectorSources: composed.selectorSources, modelAliases,
      rootModel: context.defaults.model, knownModels: context.knownModels, availableModels: context.availableModels,
      resources: context.capabilities, model: options.model ?? builtinAlias, tools: options.tools, skills: options.skills, extensions: options.extensions,
      contextFiles: options.contextFiles,
    });
    if (resolved.overrideSystemPrompt && options.systemPrompt !== undefined) {
      fail("INVALID_METADATA", `Role "${resolved.name}" has overrideSystemPrompt: true and cannot be combined with systemPrompt; use systemPromptAppend for additional instructions`);
    }
    const root = context.defaults.model;
    // A thinking-free default alias for the root physical model keeps the root thinking level.
    const aliasInheritsRoot = builtinAlias !== undefined && resolved.model?.thinking === undefined
      && resolved.model?.provider === root.provider && resolved.model.model === root.model;
    const model = aliasInheritsRoot ? root : resolved.model;
    const explicitModel = options.model !== undefined || resolved.definition?.model !== undefined || (builtinAlias !== undefined && !aliasInheritsRoot);
    if (model && (model.thinking !== undefined || explicitModel)) {
      configuration.model = `${model.provider}/${model.model}${model.thinking ? `:${model.thinking}` : ""}`;
    }
    for (const kind of ["tools", "skills", "extensions"] as const) configuration[kind] = resolved.selectorLayers[kind].flatMap(layer => layer ?? []);
    if (resolved.contextFiles !== undefined) configuration.contextFiles = [...resolved.contextFiles];
    // Workflow parity: a trusted project extensionSettings map replaces the whole global map; later layers overlay namespaces.
    const shared = composed.settings;
    const sharedSettings = Object.hasOwn(shared.project, "extensionSettings") ? shared.project.extensionSettings : shared.global.extensionSettings;
    configuration.settings = mergeExtensionSettings(sharedSettings, context.defaults.settings, resolved.definition?.extensionSettings, callSettings) ?? {};
    if (options.label === undefined && resolved.name !== undefined) configuration.label = resolved.name;
    for (const key of ["systemPrompt", "systemPromptAppend"] as const) {
      if (options[key] === undefined) continue;
      if (typeof options[key] !== "string") fail("INVALID_METADATA", `${key} must be a string`);
      configuration[key] = options[key];
    }
    if (resolved.systemPrompt.mode === "override") {
      configuration.systemPrompt = resolved.systemPrompt.text;
    } else if (resolved.systemPrompt.text) {
      configuration.systemPromptAppend = [resolved.systemPrompt.text, configuration.systemPromptAppend].filter(Boolean).join("\n\n");
    }
  }
  registry.registerWorkflowExtension({
    version: manifest.version,
    headline: "Pi roles",
    ...(source === undefined ? {} : { source }),
    agentPreparationHooks: {
      roles: {
        // Declaring every option this adapter reads lets a consumer tell them from options of an extension that failed to load.
        optionsSchema: { type: "object", properties: { role: { type: "string", minLength: 1 }, systemPrompt: {}, systemPromptAppend: {}, extensionSettings: {} }, additionalProperties: true },
        prepare(configuration, context) {
          try { prepareWorkflowRole(configuration, context); }
          catch (error) {
            // Consumers own no role code; an unknown role is invalid agent metadata there. The library keeps UNKNOWN_AGENT_TYPE.
            if (error instanceof RoleError && error.code === "UNKNOWN_AGENT_TYPE") throw new RoleError("INVALID_METADATA", error.message);
            throw error;
          }
        },
      },
    },
  });
}
