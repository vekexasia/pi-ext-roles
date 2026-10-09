import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative, resolve, isAbsolute, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { createEventBus, getAgentDir, parseArgs, DefaultResourceLoader, DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { resolveProjectAuthorization } from "./authorization.js";
import { discoverRoles, resolveRole, type RoleDiscoveryOptions } from "./roles.js";
import { collectRoleContributions } from "./contributions.js";
import { composeRoleConfiguration } from "./settings.js";
import { errorText, fail, modelAliasName, resolveModelReference, selectResourcesByLayers } from "./utils.js";
import { canonicalPath, extensionIdentity } from "./paths.js";
import { TOOL_LAYERS_FLAG } from "./cli-tool-bridge.js";

export const LAUNCHER_USAGE = "Usage: pi-role [<role> | --role <role>] [Pi arguments...]\n       pi-role --list [--approve | --no-approve]\n       pi-role <role> --identify   Print the role file path and its content\nExperimental: --discover-extension-roles loads configured extension factories to discover roles.\nWithout a role, launches stock Pi from PATH. Role extensionSettings are ignored by the CLI.\n";
const BUILTIN_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls", "powershell"];
function resourcePath(input: string, cwd: string) {
  if (input.startsWith("builtin:")) return input;
  const path = input.startsWith("file://") ? fileURLToPath(input) : input === "~" ? homedir() : input.startsWith("~/") || input.startsWith("~\\") ? join(homedir(), input.slice(2)) : input;
  return resolve(cwd, path);
}
// Mirrors the native Pi parser's value consumption so option values are never mistaken for flags.
const VALUE_OPTIONS = new Set(["--provider", "--model", "--api-key", "--system-prompt", "--append-system-prompt", "--name", "-n", "--session", "--session-id", "--fork", "--session-dir", "--models", "--tools", "-t", "--exclude-tools", "-xt", "--export", "--extension", "-e", "--skill", "--prompt-template", "--theme", "--thinking", "--role"]);
const WORD_OPTIONS = new Set(["--mode", "--use-theme", "--tui-mode"]);
type ScannedOption = { name: string; index: number; width: number };
function scanOptions(args: readonly string[]): { options: ScannedOption[]; end: number } {
  const options: ScannedOption[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i], next = args[i + 1];
    if (arg === "--") return { options, end: i };
    if (!arg.startsWith("-") || arg === "-" || arg.startsWith("@")) continue;
    let width = 0;
    if (VALUE_OPTIONS.has(arg)) width = next === undefined ? 0 : 1;
    else if (WORD_OPTIONS.has(arg)) width = next === undefined || next.startsWith("-") ? 0 : 1;
    else if (arg === "--print" || arg === "-p") width = next !== undefined && !next.startsWith("@") && (!next.startsWith("-") || next.startsWith("---")) ? 1 : 0;
    else if (arg === "--list-models") width = next !== undefined && !next.startsWith("-") && !next.startsWith("@") ? 1 : 0;
    else if (arg.startsWith("--") && arg !== "--list" && !arg.includes("=") && next !== undefined && !next.startsWith("-") && !next.startsWith("@") && !NATIVE_FLAGS.has(arg)) width = 1;
    options.push({ name: arg, index: i, width });
    i += width;
  }
  return { options, end: args.length };
}
// Native boolean flags never consume the following argument.
const NATIVE_FLAGS = new Set(["--help", "--version", "--continue", "--resume", "--no-session", "--no-tools", "--no-builtin-tools", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files", "--verbose", "--approve", "--no-approve", "--offline", "--discover-extension-roles"]);
function stripOptions(args: string[], names: readonly string[]) {
  for (const { index, width } of scanOptions(args).options.filter(option => names.includes(option.name)).reverse()) args.splice(index, width + 1);
}
function insertOptions(args: string[], options: string[]) { args.splice(scanOptions(args).end, 0, ...options); }
async function launch(args: string[], cwd: string, agentDir: string): Promise<number> {
  // Resolve the user's native executable through PATH, not the peer SDK's entrypoint.
  const child = spawn("pi", args, { cwd, env: { ...process.env, PI_CODING_AGENT_DIR: agentDir }, stdio: "inherit" });
  const signals = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 } as const;
  const handlers = Object.keys(signals).map(signal => {
    const handler = () => { child.kill(signal as NodeJS.Signals); };
    process.on(signal, handler); return { signal, handler };
  });
  try {
    return await new Promise<number>((done, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => done(code ?? signals[signal as keyof typeof signals] ?? 1));
    });
  } finally { for (const { signal, handler } of handlers) process.off(signal, handler); }
}
export async function runPiRole(argv: readonly string[], cwd = process.cwd(), agentDir = getAgentDir()): Promise<number> {
  let extensionLoadFailures = false;
  try {
    const rest = [...argv];
    const discoverExtensionRoles = scanOptions(rest).options.some(option => option.name === "--discover-extension-roles");
    stripOptions(rest, ["--discover-extension-roles"]);
    let role: string | undefined;
    const roleOption = scanOptions(rest).options.find(option => option.name === "--role");
    if (roleOption) {
      role = rest[roleOption.index + 1];
      if (!role || role.startsWith("-")) fail("UNSUPPORTED_ARGUMENT", "--role requires a name");
      rest.splice(roleOption.index, 2);
    } else if (rest[0] && !rest[0].startsWith("-")) role = rest.shift();
    const identifyOption = scanOptions(rest).options.find(option => option.name === "--identify");
    if (identifyOption) {
      const width = role ? 1 : 2;
      role ??= rest[identifyOption.index + 1];
      if (!role || role.startsWith("-")) fail("UNSUPPORTED_ARGUMENT", "--identify requires a role");
      rest.splice(identifyOption.index, width);
    }
    const head = scanOptions(rest).options.map(option => option.name);
    const list = head.includes("--list"), help = head.includes("--help") || head.includes("-h");
    if (!role && !list && !help) return await launch(rest, cwd, agentDir);
    if (list) rest.splice(scanOptions(rest).options.find(option => option.name === "--list")!.index, 1);
    const parsed = parseArgs(rest);
    const projectTrusted = resolveProjectAuthorization(cwd, agentDir, parsed.projectTrustOverride);
    const discovery: RoleDiscoveryOptions & { agentDir: string } = { cwd, agentDir, projectTrusted };
    if (discoverExtensionRoles) {
      // loader.reload() resolves packages without onMissing and would install them; fail on missing sources first, as the launcher does.
      await new DefaultPackageManager({ cwd, agentDir, settingsManager: SettingsManager.create(cwd, agentDir, { projectTrusted }) }).resolve(async () => "error");
      const eventBus = createEventBus();
      const loader = new DefaultResourceLoader({ cwd, agentDir, eventBus,
        settingsManager: SettingsManager.create(cwd, agentDir, { projectTrusted }),
        noExtensions: parsed.noExtensions, noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true });
      try {
        await loader.reload();
        const loaded = loader.getExtensions();
        extensionLoadFailures = loaded.errors.length > 0;
        for (const error of loaded.errors) process.stderr.write(`pi-role: warning: Extension ${error.path}: ${error.error}\n`);
        discovery.extensionRoleDirectories = collectRoleContributions(eventBus, loaded);
      } finally { loader.getExtensions().runtime.invalidate(); eventBus.clear(); }
    }
    if (list || help) {
      process.stdout.write(LAUNCHER_USAGE);
      for (const [name, definition] of Object.entries(discoverRoles(discovery)).sort(([a], [b]) => a.localeCompare(b))) process.stdout.write(`  ${name.padEnd(16)}${definition.description ?? ""}\n`);
      if (help && !role && !list) {
        stripOptions(rest, ["--extension", "-e"]);
        insertOptions(rest, ["--no-extensions"]);
        return await launch(rest, cwd, agentDir);
      }
      return 0;
    }
    if (identifyOption) {
      const definition = discoverRoles(discovery)[role!];
      if (!definition) fail("UNKNOWN_AGENT_TYPE", `Unknown agent role: ${role}`);
      const path = definition.provenance?.path;
      if (!path) fail("CONFIG_ERROR", `Role ${role} has no source file`);
      process.stdout.write(`${path}\n\n${readFileSync(path, "utf8")}`);
      return 0;
    }
    if (head.some(name => name === `--${TOOL_LAYERS_FLAG}` || name.startsWith(`--${TOOL_LAYERS_FLAG}=`))) fail("UNSUPPORTED_ARGUMENT", "Private tool selector flag cannot be supplied to pi-role");
    const config = composeRoleConfiguration(discovery);
    // Explicit native models remain native, including fuzzy ids and extension-provided models.
    const explicitAlias = parsed.model && !parsed.provider && modelAliasName(parsed.model, config.modelAliases);
    const selected = resolveRole(role, { ...discovery, ...(parsed.model ? { modelOverride: { provider: "native", model: "native" } } : {}) });
    const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted });
    const manager = new DefaultPackageManager({ cwd, agentDir, settingsManager, builtinExtensions: ["llama.cpp", "codemode", "tool-search", "mcp"] });
    const configured = await manager.resolve(async () => "error");
    const additions: string[] = [];
    if ((!parsed.model && !parsed.provider && selected.model) || explicitAlias) {
      const model = explicitAlias ? resolveModelReference(parsed.model!, config.modelAliases) : selected.model!;
      if (explicitAlias) stripOptions(rest, ["--model", "-m"]);
      additions.push("--model", `${model.provider}/${model.model}${model.thinking ? `:${model.thinking}` : ""}`);
    }
    if (!parsed.noContextFiles && selected.contextFiles !== undefined) {
      if (selected.contextFiles.length === 0) additions.push("--no-context-files");
      else if (!["global", "project", "cwd"].every(scope => selected.contextFiles!.includes(scope as "global" | "project" | "cwd"))) fail("UNSUPPORTED_ARGUMENT", "Partial contextFiles scope is unsupported by native Pi argv; use all scopes or []");
    }
    if (parsed.systemPrompt === undefined && selected.overrideSystemPrompt) additions.push("--system-prompt", selected.prompt);
    else if (!selected.overrideSystemPrompt && selected.prompt) {
      stripOptions(rest, ["--append-system-prompt"]);
      const loader = new DefaultResourceLoader({ ...discovery, settingsManager: SettingsManager.create(cwd, agentDir, { projectTrusted }), noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true, appendSystemPrompt: parsed.appendSystemPrompt });
      try { await loader.reload(); additions.push("--append-system-prompt", [...loader.getAppendSystemPrompt(), selected.prompt].join("\n\n")); }
      finally { loader.getExtensions().runtime.invalidate(); }
    }
    const authorizePath = (path: string, resources: typeof configured.extensions) => {
      const resource = resources.find(r => extensionIdentity(r.path) === extensionIdentity(path));
      const within = relative(canonicalPath(cwd), canonicalPath(path));
      const projectPath = !isAbsolute(within) && within !== ".." && !within.startsWith("../");
      if (resource?.enabled === false || !projectTrusted && (resource?.metadata.scope === "project" || !path.startsWith("builtin:") && projectPath)) fail("CONFIG_ERROR", `Resource is disabled or unauthorized: ${path}`);
    };
    for (const [paths, resources] of [[parsed.extensions, configured.extensions], [parsed.skills, configured.skills], [parsed.themes, configured.themes], [parsed.promptTemplates, configured.prompts]] as const) {
      for (const input of paths ?? []) {
        if (/^(npm:|git:|github:|https?:|ssh:)/.test(input)) {
          if (resources.some(r => r.metadata.source === input && (!r.enabled || !projectTrusted && r.metadata.scope === "project"))) fail("CONFIG_ERROR", `Resource is disabled or unauthorized: ${input}`);
          continue;
        }
        authorizePath(resourcePath(input, cwd), resources);
      }
    }
    const sources = parsed.extensions ?? [];
    const remoteSources = sources.filter(source => /^(npm:|git:|github:|https?:|ssh:)/.test(source));
    const local = await manager.resolveExtensionSources(sources.filter(source => !remoteSources.includes(source)).map(source => resourcePath(source, cwd)), { temporary: true });
    for (const resource of local.extensions) authorizePath(resource.path, configured.extensions);
    const explicit = { extensions: [...local.extensions, ...configured.extensions.filter(r => remoteSources.includes(r.metadata.source))] };
    if (selected.selectorLayers.extensions.some(layer => layer !== undefined)) {
      for (const source of remoteSources) if (!configured.extensions.some(r => r.metadata.source === source)) fail("UNSUPPORTED_ARGUMENT", `Resource metadata is not configured: ${source}`);
      const candidates = [...new Set([...(parsed.noExtensions ? [] : configured.extensions.filter(r => r.enabled).map(r => r.path)), ...explicit.extensions.filter(r => r.enabled).map(r => r.path)])];
      const paths = selectResourcesByLayers(selected.selectorLayers.extensions, candidates.map(extensionIdentity));
      stripOptions(rest, ["--extension", "-e"]);
      additions.push("--no-extensions", ...paths.flatMap(path => ["--extension", path]));
    }
    if (selected.selectorLayers.skills.some(layer => layer !== undefined)) {
      // A no-extension loader enumerates skill metadata without executing any factory.
      const loader = new DefaultResourceLoader({ ...discovery, settingsManager, noExtensions: true, noSkills: parsed.noSkills, additionalSkillPaths: parsed.skills?.map(path => resourcePath(path, cwd)), noThemes: true, noPromptTemplates: true });
      try {
        await loader.reload();
        const skills = loader.getSkills().skills;
        const names = selectResourcesByLayers(selected.selectorLayers.skills, skills.map(s => s.name));
        stripOptions(rest, ["--skill"]);
        additions.push("--no-skills", ...skills.filter(s => names.includes(s.name)).flatMap(s => ["--skill", s.filePath]));
      } finally { loader.getExtensions().runtime.invalidate(); }
    }
    // Native 1.0.x treats --tools as stronger than noTools and no-builtin-tools only
    // as an initial loadout. Compose hard registry ceilings, not just a UI filter.
    if (parsed.noTools) additions.push("--tools", "");
    else if (parsed.noBuiltinTools) additions.push("--exclude-tools", [...new Set([...(parsed.excludeTools ?? []), ...BUILTIN_TOOLS])].join(","));
    if (selected.selectorLayers.tools.some(layer => layer !== undefined) && !parsed.noTools) {
      const layers = parsed.tools === undefined ? selected.selectorLayers.tools : [undefined, undefined, undefined, ["!*", ...parsed.tools]];
      additions.unshift("--extension", fileURLToPath(new URL("./cli-tool-bridge.js", import.meta.url)), `--${TOOL_LAYERS_FLAG}`, JSON.stringify(layers));
    }
    insertOptions(rest, additions);
    return await launch(rest, cwd, agentDir);
  } catch (error) {
    const note = extensionLoadFailures && error instanceof Error && "code" in error && error.code === "UNKNOWN_AGENT_TYPE" ? " (some extensions failed to load; see warnings above)" : "";
    process.stderr.write(`pi-role: ${errorText(error)}${note}\n`); return 1;
  }
}
