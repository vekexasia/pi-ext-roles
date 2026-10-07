import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { collectRoleContributions } from "./contributions.js";
import { resolveRole } from "./roles.js";
import { composeRoleConfiguration, validateExtensionSettings } from "./settings.js";
import type { AgentResourceSelectorSources, ContextFileScope, ExtensionSettings, ModelSpec } from "./types.js";
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
  readonly agentDir: string;
  readonly projectTrusted: boolean;
  readonly defaults: Readonly<{
    model: ModelSpec;
    modelAliases: Readonly<Record<string, string>>;
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
export function registerWorkflowRoles(api: Pick<ExtensionAPI, "events">, registry: {
  registerWorkflowExtension(extension: {
    version: string;
    headline: string;
    agentPreparationHooks: Readonly<Record<string, {
      optionsSchema: { type: "object"; properties: { role: { type: "string"; minLength: number } }; additionalProperties: true };
      prepare(configuration: AgentPreparation, context: Readonly<AgentPreparationContext>): void;
    }>>;
  }): void;
}): void {
  const manifest: unknown = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  if (!object(manifest) || typeof manifest.version !== "string") fail("INVALID_METADATA", "Roles manifest requires a version");
  function prepareWorkflowRole(configuration: AgentPreparation, context: Readonly<AgentPreparationContext>): void {
    context.signal.throwIfAborted();
    if (typeof context.projectTrusted !== "boolean") fail("CONFIG_ERROR", "Workflow roles require an explicit project trust decision");
    const options = context.options;
    if (options.role !== undefined && typeof options.role !== "string") fail("INVALID_METADATA", "Invalid role name: expected a string");
    const composed = composeRoleConfiguration({ cwd: context.cwd, agentDir: context.agentDir, projectTrusted: context.projectTrusted,
      selectorSources: context.defaults.selectorSources, modelAliases: context.defaults.modelAliases });
    const callSettings = validateExtensionSettings(options.extensionSettings, "agent options");
    const resolved = resolveRole(options.role, {
      cwd: context.cwd, agentDir: context.agentDir, projectTrusted: context.projectTrusted,
      extensionRoleDirectories: collectRoleContributions(api.events, { activeOnly: true }),
      useSharedSettings: false, selectorSources: composed.selectorSources, modelAliases: composed.modelAliases,
      rootModel: context.defaults.model, knownModels: context.knownModels, availableModels: context.availableModels,
      resources: context.capabilities, model: options.model, tools: options.tools, skills: options.skills, extensions: options.extensions,
      contextFiles: options.contextFiles,
    });
    if (resolved.model && (resolved.model.thinking !== undefined || options.model !== undefined || resolved.definition?.model !== undefined)) {
      configuration.model = `${resolved.model.provider}/${resolved.model.model}${resolved.model.thinking ? `:${resolved.model.thinking}` : ""}`;
    }
    for (const kind of ["tools", "skills", "extensions"] as const) configuration[kind] = resolved.selectorLayers[kind].flatMap(layer => layer ?? []);
    if (resolved.contextFiles !== undefined) configuration.contextFiles = [...resolved.contextFiles];
    configuration.settings = mergeExtensionSettings(composed.settings.effective.extensionSettings, context.defaults.settings, resolved.definition?.extensionSettings, callSettings) ?? {};
    if (options.label === undefined && resolved.name !== undefined) configuration.label = resolved.name;
    for (const key of ["systemPrompt", "systemPromptAppend"] as const) {
      if (options[key] === undefined) continue;
      if (typeof options[key] !== "string") fail("INVALID_METADATA", `${key} must be a string`);
      configuration[key] = options[key];
    }
    if (resolved.systemPrompt.mode === "override") {
      if (options.systemPrompt === undefined) configuration.systemPrompt = resolved.systemPrompt.text;
    } else if (resolved.systemPrompt.text) {
      configuration.systemPromptAppend = [resolved.systemPrompt.text, configuration.systemPromptAppend].filter(Boolean).join("\n\n");
    }
  }
  registry.registerWorkflowExtension({
    version: manifest.version,
    headline: "Pi roles",
    agentPreparationHooks: {
      roles: {
        optionsSchema: { type: "object", properties: { role: { type: "string", minLength: 1 } }, additionalProperties: true },
        prepare: prepareWorkflowRole,
      },
    },
  });
}
