# Roles guide

Role authoring, configuration, programmatic APIs, the optional workflow adapter and the native `pi-role` launcher.
See the [README](../README.md) for installation and quick start.

## Write your first role

Create `~/.pi/agent/pi-ext-roles/roles/code-reader.md` (or
`.pi/pi-ext-roles/roles/code-reader.md` in an explicitly authorized project):

```markdown
---
description: Read code and report findings without editing
tools: ['!*', read, grep, find, ls]
---
Trace the relevant code and report concrete findings. Do not edit files.
```

The filename selects the role name. The body appends instructions to Pi's system
prompt; `overrideSystemPrompt: true` selects replacement mode (see native CLI
limits below). Roles are trusted configuration, not a sandbox. Run
`pi-role code-reader` or `pi-role code-reader -p "Explain the startup path"`.
Use `pi-role --list` to inspect discovered names without loading extension factories. To try configured extension contributions, use `pi-role --discover-extension-roles --list`.
The fallback roles deliberately have no model: select one through native Pi,
`--model provider/model:thinking`, or a role/shared alias.

For shared aliases, create `~/.pi/agent/pi-ext-roles/settings.json`:

```json
{
  "modelAliases": {
    "reader-model": "provider/model:medium"
  }
}
```

Replace `provider/model` with your actual provider and model ID, then set
`model: reader-model` in the role frontmatter. The optional fields are:

| Field | Meaning |
| --- | --- |
| `description` | Discovery description |
| `model` | Concrete model reference or configured alias |
| `tools`, `skills`, `extensions` | Ordered selectors over supplied/discovered candidates |
| `extensionSettings` | JSON extension namespaces returned to programmatic consumers; ignored by CLI |
| `overrideSystemPrompt` | Replace rather than append the role body |
| `contextFiles` | Context scopes: `global`, `project`, `cwd`; `[]` means none |

Selectors are operations: `['!*', 'read', 'grep']` clears the loadout and adds those
candidates; `[]` changes nothing; later positive patterns can re-enable candidates
within consumer ceilings. Relative extension selectors resolve from the role file.
There is no role inheritance. Invalid role metadata blocks discovery instead of
silently skipping the role.

Context scopes select the agent-directory context file (`global`), exact working
directory context file (`cwd`), and discovered ancestor/project files excluding
those two (`project`). Omission retains normal context discovery. Programmatic
consumers apply partial scopes; native CLI supports only all scopes or none.

## Migrating from workflow-owned roles

Move global roles from `~/.pi/agent/pi-extensible-workflows/roles/` to
`~/.pi/agent/pi-ext-roles/roles/`, and project roles from
`.pi/pi-extensible-workflows/roles/` to `.pi/pi-ext-roles/roles/`. Move shared
`modelAliases`, `tools`, `skills`, `extensions` and `extensionSettings` to the new
`pi-ext-roles/settings.json`. No files are moved or rewritten automatically.

Workflow consumers no longer discover roles, import this package or provide the
old `/roles` exports, CLI binary, legacy directories or role snapshots. Load the
roles Pi extension explicitly alongside workflows to retain
`agent('task', { role: 'reviewer' })`. Unknown agent options are opaque JSON:
without the plugin, `role` is ignored, even when it is not a string. With the
plugin, its schema requires a nonempty string; the library validates the name
and discovers the definition. No files or old persisted runs are migrated.

For the standalone binary, upgrade the old global `@piewf/cli` first so it no
longer owns `pi-role`, then install `@piewf/pi-ext-roles`. Do not force an overwrite
of the old binary.

Extension authors replace `registerWorkflowExtension({ roleDirectories })` with
`registerRoleContribution` below. Keep unrelated workflow registration, including
`source`, in workflows. The five model-free fallback roles always remain
available. The workflow adapter applies a configured `<role>-model` alias to
them; elsewhere configure a model/alias explicitly if you relied on an old workflow
fallback model. Runtime creation, persistence, settings delivery and disposal
remain the consumer's responsibility, not this package's.

## Optional workflow adapter

The Pi factory asynchronously resolves the optional workflows registry and
registers one `agentPreparationHooks.roles` hook, before registry freeze. It does
not import workflows when the package is absent. A present but broken registry,
API or registration fails visibly. Materializing child sessions after freeze
never registers the hook again. No roles singleton or workflow dependency is
used by the root library or native launcher. `@piewf/pi-ext-roles/workflow` is an
isolated adapter export; it is not re-exported from the root.

The hook reads the original, immutable agent options and explicit consumer trust.
It collects contributions on this Pi event bus with `activeOnly: true`, after
normal `session_start`. Consumers must start and retain that runtime before
preparation, and dispose it when the operation ends. No factory discovery replay
or fake lifecycle is needed. Shared settings apply even when `role` is omitted.
Role files and shared settings come from the consumer's launch project
(`projectCwd`, falling back to `cwd`), also for worktree agents. Relative extension
selectors in role files and shared settings stay relative to their file in the
launch project; relative call selectors resolve against the execution `cwd`, so a
worktree agent's call selects the worktree's copy.

The Pi entry registers the hook with its own module URL as `source`, so a consumer
can prove the hook's extension loaded. The hook's `optionsSchema` validates `role` and declares the other options it reads
(`systemPrompt`, `systemPromptAppend`, `extensionSettings`) without validating them,
so a consumer can tell them apart from options of an extension that failed to load.
An unknown role fails preparation with `INVALID_METADATA` and the message
`Unknown agent role: <name>`; the library and native launcher keep
`UNKNOWN_AGENT_TYPE`.

Selectors become complete ordered arrays: shared global/project, consumer
global/project, role, call. Relative role extension selectors retain their file
provenance. Call model and context scopes override the role; model aliases become
physical model references. An alias target without thinking becomes
`provider/model` without an invented thinking level; the original call options
retain the alias for consumer recovery validation before preparation. An inherited
consumer model without a thinking level stays implicit. When the consumer supplies
`defaults.dynamicModelAliasNames`, aliases resolve extension-dynamic < shared <
consumer static; otherwise consumer aliases overlay shared ones. Shared aliases
resolve only inside this hook, so a consumer catalog or doctor alias inventory does
not list them. A packaged fallback role (one of the five files shipped in this
package, not overridden and not a contribution that declares a `builtin` scope),
without call or role model, uses a `<role>-model` alias when one is configured in
any layer. A configured alias whose target is unavailable fails with
`UNKNOWN_MODEL`, like any explicit alias. Without such an alias the role inherits
the root model and its thinking level; a virtual `workflow/<alias>` root model is
passed on unchanged for the consumer to resolve. The library, CLI and role files
stay model-free. A trusted project `extensionSettings` map, including
`{}`, replaces the shared global map; consumer/parent, role, then call
`extensionSettings` replace individual namespaces. The library keeps its
per-namespace shared merge.
An explicit label wins; otherwise the role supplies it. Role instructions append through
`systemPromptAppend`, or set the `systemPrompt` base for override roles. An
explicit call `systemPrompt`, including an empty string, conflicts with a role
whose `overrideSystemPrompt` is true. Preparation fails with `INVALID_METADATA`
before session creation; use `systemPromptAppend` to add instructions instead.
Without role override, an explicit call base remains valid and the role body
still appends. An explicit `systemPromptAppend` replaces the prepared append channel
before nonoverride role instructions are prepended. The consumer performs final concrete
model, context, settings and capability validation under root/parent ceilings;
the plugin cannot authorize extra capabilities.

The plugin also appends role-call syntax, supported defaults and their call
precedence, followed by discovered descriptions, to structured
`before_agent_start.systemPromptOptions.appendSystemPrompt` when workflow or
standalone-subagent tools are available, preserving an existing append. It never
forces the complete prompt. Descriptions use Pi's configured agent directory
(`PI_CODING_AGENT_DIR`, or its default), this runtime's active contributors and
its concrete project trust decision. This preserves dynamic tool transcript
deltas and the provider prefix (#311).

New workflow runs freeze the generic prepared configuration before dispatch,
including resolved model, plugin instructions, selectors, context scopes and
settings. Retry/resume of the same logical agent and persistent handle reuse that
configuration without rereading role definitions or shared settings; new agents
and new nested identities resolve current configuration. Standalone retry copies
the prepared configuration. Old workflow snapshots and old standalone
configuration formats are incompatible, with no compatibility bridge.

This does not freeze extension code, skill/context/AGENTS/SYSTEM/APPEND bytes, or
external state. Those resources are reread under current trust and ceilings;
loss of prior trust or required capabilities blocks recovery. No exactly-once
external-effects guarantee is implied. Native `pi-role` remains different:
relaunch resolves live role files, while session storage stays native Pi's.

## Configuration and resolution

Global: `~/.pi/agent/pi-ext-roles/{settings.json,roles/*.md}`. Authorized project: `<cwd>/.pi/pi-ext-roles/{settings.json,roles/*.md}`. Pi's configured agent directory is respected. Settings support `modelAliases`, ordered `tools`, `skills`, `extensions` selectors and JSON `extensionSettings` namespaces. Project aliases replace the entire global alias map, including `{}`. Explicit consumer aliases overlay that effective map.

Frontmatter supports `model`, `description`, `tools`, `skills`, `extensions`, `extensionSettings`, `overrideSystemPrompt` (also `override_system_prompt` and `is_system_prompt`) and `contextFiles: [global, project, cwd]`. Physical role models retain the `provider/model:thinking` contract. Aliases may supply thinking. Standalone `thinking` and `disabledAgentResources` metadata are rejected. No inheritance.

API discovery precedence: fallback < contributor < global < authorized project. Default CLI discovery is fallback < global < authorized project; it never runs contributor factories to discover roles. Experimental `--discover-extension-roles` enables contributor discovery while retaining all five unconditional fallback roles. `additionalRoleSources` accepts `{path, scope, priority, owner?, extension?}`. Larger priority wins within a scope; standard global/project directories have priority 100, permitting low-priority compatibility sources without teaching this package their names. Contributor name collisions fail. Missing user directories are allowed; missing contributor directories fail. Symlinks use canonical filesystem identity. Definitions carry serializable `provenance`, preserving relative extension selectors across clones and API copies.

`resolveRole(name, options)` reads live shared settings by default, even with explicit `selectorSources` or `modelAliases`. For a captured run, pass `useSharedSettings: false` to `resolveRole` or `composeRoleConfiguration`: no settings files are read, supplied `selectorSources` (including `defaults`) and `modelAliases` are used as captured, and supplied extension settings merge only with role settings. Capture definitions separately to avoid rediscovering role files. Captured composition returns `settings: undefined`; launch/recovery consumers retain the default live composition when capturing a new configuration. Ordering is shared global/project, consumer global/project, role, call. Without explicit consumer sources there are four selector layers; with shared selectors and consumer sources there are six, represented by `selectorSources.defaults`. Arrays are operations, not allowlists: absent and `[]` do nothing, `['!*']` disables everything, later positive selectors re-enable only supplied candidates. All supplied `rootTools`, `inheritedTools` and `resources.tools` ceilings intersect; omitted ceilings do not invent candidates. Exact consumer tool requests and `effectiveTools` must fit the intersection. Other `resources` candidates bound selection. `effectiveTools` must also respect the tool ceiling. The effective explicit model is validated after overrides; invalid values never fall back.

Call options can override model, tools/skills/extensions, context, prompt, prompt mode and extension settings. Extension settings merge by namespace: shared global, shared project, role, call. Empty maps remain valid and do not erase preceding namespaces. Extension-specific schema validation belongs to each consumer.

## Source API

Package entrypoints: `.`, `/roles`, `/types`, `/settings`, `/paths`, `/utils`, `/launcher`, `/workflow`. Every entrypoint includes declarations; `src/extension.ts` is the Pi manifest entrypoint.

- Root exports the roles, types, settings, paths and contributions APIs.
- `/roles`: `parseRoleMarkdown(content, strict?, rolePath?)`, `discoverRoles`, `resolveRole`, `loadRole`, `loadAgentDefinitions`, `loadProjectAgentDefinitions`, `roleDirectories`, `canonicalExtensionSelector`, `validateRoleName`; `RoleDirectoryInput`, `RoleDiscoveryOptions`, `RoleResourceCandidates`, `RoleResolutionOptions`, `ResolvedRole`.
- `/types`: independent `RoleError`, `RoleErrorCode`, `ERROR_CODES`; `AgentDefinition`/`RoleDefinition`, `ModelSpec`, `ThinkingLevel`, JSON/extension settings, resource selector contracts (including neutral aliases), context scopes and guard, contribution directory/metadata/provenance/settings contracts.
- `/settings`: paths, `loadSettings`, `resolveRoleSettings`, `composeRoleConfiguration`, `validateSelectorList`, `validateContextFileScopes`, `validateExtensionSettings`. Configuration composition returns shared settings/source paths, selector sources and effective aliases for consumer setup. Pass original consumer overlays to `resolveRole`, not a separately rebuilt allowlist.
- `/paths`: `canonicalPath`, `extensionIdentity`, `sameFilesystemPath`.
- `/utils`: JSON checks/namespace merge, freeze/object/error helpers, model reference/alias/thinking validation and resolution, capability extraction, minimatch validation/matching/ordered selection/unmatched diagnostics. No unrelated runtime helpers.
- `/launcher`: `runPiRole(argv, cwd?, agentDir?)`, `LAUNCHER_USAGE`.
- `/workflow`: `registerWorkflowRoles(pi, registry, source?)` and structural preparation types. `source` is the module URL of the Pi extension entry that calls it, so consumers can prove the registration came from a loaded extension. The Pi factory normally registers this adapter automatically, with its own `import.meta.url`, when workflows is present.

Role names must be nonempty, without marginal whitespace or path separators, and cannot be `.`, `..`, `__proto__`, `constructor` or `prototype`. Pure discovery has no implicit contribution registry. A Pi consumer supplies the directories collected from its actual loaded extension set. Minimal contributor:

```ts
import { registerRoleContribution } from '@piewf/pi-ext-roles';
export default function (pi) {
  registerRoleContribution(pi, {
    owner: import.meta.url,
    roleDirectories: ['./roles'],
    extension: { headline: 'My extension', version: '1.0.0' },
  });
}
```

`registerRoleContribution` returns unsubscribe. `collectRoleContributions(bus, membership)` emits `pi-ext-roles:collect:v1` and accepts only synchronous replies from member owners. Duplicate registrations are deduplicated; async replies are ignored, not awaited. Different installed copies share only this wire contract, not a singleton. Registration is tracked by Pi's runtime and removed on invalidation. The registration API accepts optional `on`: when provided, `session_start` activates the contribution and `session_shutdown` deactivates it. `collectRoleContributions(bus, { activeOnly: true })` collects only synchronous replies marked active by that lifecycle, without a loaded-owner list. Registrations without `on` still support explicit-owner collection but never become active for `activeOnly` collection. Unsubscribe permanently disables the registration. Generic global/project sources can be contributed by authorized adapters. Owner metadata is a cooperative contract between trusted factories, not a security sandbox.

Independent consumers can use the returned plain options or capture generic prepared configuration. Parent tool/result/setup policy stays in the consumer; workflow recovery never persists role definitions or re-resolves an already prepared name.

## Native CLI

`pi-role` composes role files, shared settings and native argv, then spawns **one normal `pi` executable resolved through process PATH**, with inherited stdin/stdout/stderr. It does not create an SDK session, call Pi `main`, run preliminary Pi processes, or execute extension factories before spawn unless `--discover-extension-roles` is supplied. No role forwards argv unchanged. Role/list/help scanning stops at `--`; prompts after it are untouched. `--list` and selected-role help use pure discovery with zero factories; unselected help additionally shows native Pi help with extension discovery/explicit extensions suppressed, so factories still do not run by default.

Experimental opt-in:

```sh
pi-role --discover-extension-roles --list
pi-role --discover-extension-roles auditor
```

The flag loads configured, enabled, trust-visible extension factories before list/help or selected-role resolution, then passes their `collectRoleContributions` directories to the pure APIs. The five fallback roles remain visible even when the roles extension is disabled; only contributed roles require their contributor to load. `--no-extensions` suppresses configured contributions too. Discovery does not load additional `-e` sources or apply role/shared extension selectors: those remain final-process options. With no selected role, list, or help, the flag is stripped and stock Pi is launched without a discovery pass. Flags after `--` and flag-shaped option values are untouched.

Discovery never installs packages: a configured npm/git package that is missing fails the run with `Missing source: ...` (as in normal launch) before any factory loads. The `pi-role` executable exits explicitly after the run (stdio drained), so timers or servers leaked by discovery factories cannot keep it alive; `runPiRole` itself never exits the host process. Load failures produce warnings on stderr and collection continues with successful extensions. Unknown-role errors mention prior load failures. The discovery runtime is invalidated before native launch. Factories run once for discovery and again in the final Pi process; factory side effects and added startup time are the opt-in tradeoff. No session is started during discovery. Without the flag, behavior is unchanged.

The native process owns interactive regular/fullscreen, print text/JSON, RPC, stdin, images/@files, sessions/resume/fork/export, provider/API-key/model/thinking and extension flags. Arguments remain native except the necessary role prompt/resource/tool composition. Role models and shared aliases become concrete `--model provider/model:thinking` argv without catalog validation before the final native extensions load. Explicit non-alias models are forwarded unchanged and never fall back to the role model. Native Pi can accept unknown IDs as custom models for known providers; native validation/transport decides their validity. Invalid providers fail in native Pi.

CLI **ignores shared and per-role `extensionSettings`**. It neither delivers `event.settings` nor exposes a settings bus channel. Programmatic consumers receive resolved settings and supply contributor directories from their own loaded extensions.

Enabled/authorized resource candidates come from pure package metadata. Skills are enumerated with a no-extension ResourceLoader; no contributor or selected-out factory runs. Extension selection becomes `--no-extensions` plus selected explicit paths (including native builtins). Skill selection becomes `--no-skills` plus selected skill files. Disabled resources and unauthorized explicit project paths are rejected before launch. Project authorization is explicit approve/no-approve, saved trust, then global `defaultProjectTrust: always`; otherwise denied. No executable trust prepass. Missing remote resource metadata is not installed by the launcher. Dynamic extension-contributed resources are outside this static selector enumeration.

### Tool contract

Role/shared `tools` selectors control **model-declared loadout**, not a universal permission/security sandbox. Registered deferred/codemode tools can remain callable through `ctx.executeTool()` even when not declared; hidden/model-only tools have Pi's native exposure semantics. Trusted extensions retain native capabilities.

Only when tool selectors need applying, the final Pi receives an explicit `--extension` for the packaged `dist/cli-tool-bridge.js`. Its private string flag carries four validated ordered selector layers. The bridge reuses selector validation/selection, obtains native `pi.getAllTools()`, and applies the loadout on `session_start` (including reload) and before agent turns. Malformed payloads visibly terminate startup with no open/default loadout. The bridge owns no global registry, provider/workflow registration or persisted role SDK snapshot. Native reload propagates runtime flag values.

Explicit native `--tools` overrides role/shared loadout and is a hard allowlist ceiling, `--exclude-tools` is a hard exclusion, `--no-tools` absolutely wins, and `--no-builtin-tools` excludes builtin names while permitting eligible extension tools. Pi 1.0.x internally gives `tools` priority over `noTools` and treats `no-builtin-tools` as an initial loadout only. The selected launcher therefore appends an empty native `--tools` for no-tools, or merged builtin exclusions for no-builtin-tools. Native registry filtering, not merely a UI list, prevents reenabling excluded tools at startup, reload or later turns. In the tested 1.0.0/1.0.2 source, `_refreshToolRegistry` (the registry builder) filters definitions and callable `_toolRegistry` entries using `_isAllowedTool`; no-tools also empties `getAllTools()` in these versions. Enumeration alone is not a permission check.

### Native scope/prompt limits

`contextFiles: []` maps to native `--no-context-files`; all `[global, project, cwd]` scopes use native context discovery. Partial scopes fail explicitly as unsupported unless the user supplies `--no-context-files`. There is no `local` scope alias or context bridge. Programmatic resolution returns the requested scopes for the consumer to apply.

Role override prefixes use native `--system-prompt`, including an empty string. Pi cannot represent an exact initially empty prefix with stock argv: empty input retains native default-prefix semantics. The CLI does not install a prompt workaround. Nonoverride role text appends after native append resources. Explicit system/append prompt flags use native file/inline resolution. Native sessions persist native state, not role snapshots; relaunch resolves role files again. Signals are forwarded to native Pi; shutdown events follow native signal behavior (abrupt RPC signals need not emit shutdown).

### Pure programmatic options

`discoverRoles`, `resolveRole` and `composeRoleConfiguration` read role/settings files and return definitions or configuration options. They execute no extension factories, create no SDK model runtime, session manager, agent session or resource loader, and acquire no session/provider resources. Package metadata and event-bus contribution APIs remain available; consumers own the bus and loaded membership.

`resolveRole` returns the model, prompt mode/text, selector sources/layers, tools selected within consumer ceilings, selected skills/extensions, extension settings namespaces and context scopes. Consumers apply those options to their own runtime and own resource loading, settings delivery, context filtering, persistence and disposal. Independent library consumers can retain definitions and use `useSharedSettings: false`; the workflow adapter instead prepares a generic configuration once, with no role-owned session snapshot protocol.

Tests cover pure resolution/composition, resource ceilings, consumer-captured configuration and contribution lifecycle, plus real native launches for factory-once/selected-out exclusion, pure list/help, aliases, wildcard loadouts/reload, explicit ceilings/reenable attempts, malformed boundary shutdown, context limits, stdin/native sessions, and local synthetic-provider model requests. Nested `ctx.executeTool()` verifies deferred/codemode calls under loadout-only selection; malicious model calls cannot invoke any exposure under no-tools. PTY smoke inspects selected/unselected regular TUI and selected fullscreen, exiting via Ctrl+D. The optional adapter tests use the real Pi loader/lifecycle with an explicit registry fixture; paired workflow SDK/CLI verification belongs to the integration harness. The #311 regression uses a real SDK session and provider serializer with synthetic SSE, not a remote cache-hit or live web test. Pi 1.0.3, paid providers and external MCP servers are not tested here.
