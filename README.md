# @piewf/pi-ext-roles

Independent Markdown roles for Pi 1.0.0, Node >=22.19.0. Includes `pi-role`, a source Pi contribution entrypoint, and five model-free fallback roles: developer, oracle, researcher, reviewer and scout.

```sh
npm ci
npm run check
npm run test:package
npm run test:terminal # optional Python 3 + Unix PTY smoke
npm pack
pi-role scout
pi-role scout -p --model provider/model:medium "Inspect this code"
pi-role --list --approve
pi-role --version # no selection: stock Pi
```

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
Use `pi-role --list` to inspect discovered names without loading extension factories.
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

Workflow consumers temporarily support old paths/imports and settings overrides,
with migration warnings in TUI; this package and its native CLI never read those
workflow paths automatically. Workflow users receive the library through workflow's
dependency and need no separately enabled roles plugin for workflow agent calls.
For the standalone binary, upgrade the old global `@piewf/cli` first so it no longer
owns `pi-role`, then install this package after registry publication. Do not force
an overwrite of the old binary. This repository currently uses a local development
artifact; these registry upgrade instructions describe the planned release.

Extension authors replace `registerWorkflowExtension({ roleDirectories })` with
`registerRoleContribution` below. Keep unrelated workflow registration, including
`source`, in workflows; re-export portable bundles using the removed field.
Fallback roles are model-free: configure a model/alias explicitly if you relied on
an old workflow fallback model. Runtime creation, persistence, settings delivery
and disposal remain the consumer's responsibility, not this package's.

This README is the standalone authoring/API/CLI reference. Workflow agent-call,
subagent and compatibility behavior remains in the workflow consumer guide.

## Releases

GitHub Actions runs checks, packed installation/type checks and Unix PTY smoke
on `main`, pull requests and release tags. `.github/workflows/publish.yml`
publishes matching `vX.Y.Z` tags after checks pass, using npm Trusted Publishing
with Node 24 and no permanent npm token. An already published version is skipped.

For the initial `0.1.0` release, authenticate once with `npm login --auth-type=web`
and publish with `npm publish --access public` after verification. Then configure
npm's package Settings / Trusted publishing for GitHub owner `vekexasia`,
repository `pi-ext-roles`, workflow `publish.yml`, with no environment configured.
Only after that setup, push the matching release tag. Later releases update the
manifest/lockfile version, pass checks, commit and push the matching tag. Registry
publication is separate from the local workflow consumer dependency update.

## Configuration and resolution

Global: `~/.pi/agent/pi-ext-roles/{settings.json,roles/*.md}`. Authorized project: `<cwd>/.pi/pi-ext-roles/{settings.json,roles/*.md}`. Pi's configured agent directory is respected. Settings support `modelAliases`, ordered `tools`, `skills`, `extensions` selectors and JSON `extensionSettings` namespaces. Project aliases replace the entire global alias map, including `{}`. Explicit consumer aliases overlay that effective map.

Frontmatter supports `model`, `description`, `tools`, `skills`, `extensions`, `extensionSettings`, `overrideSystemPrompt` (also `override_system_prompt` and `is_system_prompt`) and `contextFiles: [global, project, cwd]`. Physical role models retain the `provider/model:thinking` contract. Aliases may supply thinking. Standalone `thinking` and `disabledAgentResources` metadata are rejected. No inheritance.

API discovery precedence: fallback < contributor < global < authorized project. CLI discovery is fallback < global < authorized project; it never runs contributor factories to discover roles. `additionalRoleSources` accepts `{path, scope, priority, owner?, extension?}`. Larger priority wins within a scope; standard global/project directories have priority 100, permitting low-priority compatibility sources without teaching this package their names. Contributor name collisions fail. Missing user directories are allowed; missing contributor directories fail. Symlinks use canonical filesystem identity. Definitions carry serializable `provenance`, preserving relative extension selectors across clones and API copies.

`resolveRole(name, options)` reads live shared settings by default, even with explicit `selectorSources` or `modelAliases`. For a captured run, pass `useSharedSettings: false` to `resolveRole` or `composeRoleConfiguration`: no settings files are read, supplied `selectorSources` (including `defaults`) and `modelAliases` are used as captured, and supplied extension settings merge only with role settings. Capture definitions separately to avoid rediscovering role files. Captured composition returns `settings: undefined`; launch/recovery consumers retain the default live composition when capturing a new configuration. Ordering is shared global/project, consumer global/project, role, call. Without explicit consumer sources there are four selector layers; with shared selectors and consumer sources there are six, represented by `selectorSources.defaults`. Arrays are operations, not allowlists: absent and `[]` do nothing, `['!*']` disables everything, later positive selectors re-enable only supplied candidates. All supplied `rootTools`, `inheritedTools` and `resources.tools` ceilings intersect; omitted ceilings do not invent candidates. Exact consumer tool requests and `effectiveTools` must fit the intersection. Other `resources` candidates bound selection. `effectiveTools` must also respect the tool ceiling. The effective explicit model is validated after overrides; invalid values never fall back.

Call options can override model, tools/skills/extensions, context, prompt, prompt mode and extension settings. Extension settings merge by namespace: shared global, shared project, role, call. Empty maps remain valid and do not erase preceding namespaces. Extension-specific schema validation belongs to each consumer.

## Source API

Package entrypoints: `.`, `/roles`, `/types`, `/settings`, `/paths`, `/utils`, `/launcher`. Every entrypoint includes declarations; `src/extension.ts` is the Pi manifest entrypoint.

- Root exports the roles, types, settings, paths and contributions APIs.
- `/roles`: `parseRoleMarkdown(content, strict?, rolePath?)`, `discoverRoles`, `resolveRole`, `loadRole`, `loadAgentDefinitions`, `loadProjectAgentDefinitions`, `roleDirectories`, `canonicalExtensionSelector`; `RoleDirectoryInput`, `RoleDiscoveryOptions`, `RoleResourceCandidates`, `RoleResolutionOptions`, `ResolvedRole`.
- `/types`: independent `RoleError`, `RoleErrorCode`, `ERROR_CODES`; `AgentDefinition`/`RoleDefinition`, `ModelSpec`, `ThinkingLevel`, JSON/extension settings, resource selector contracts (including neutral aliases), context scopes and guard, contribution directory/metadata/provenance/settings contracts.
- `/settings`: paths, `loadSettings`, `resolveRoleSettings`, `composeRoleConfiguration`, `validateSelectorList`, `validateContextFileScopes`, `validateExtensionSettings`. Configuration composition returns shared settings/source paths, selector sources and effective aliases for consumer setup. Pass original consumer overlays to `resolveRole`, not a separately rebuilt allowlist.
- `/paths`: `canonicalPath`, `extensionIdentity`, `sameFilesystemPath`.
- `/utils`: JSON checks/namespace merge, freeze/object/error helpers, model reference/alias/thinking validation and resolution, capability extraction, minimatch validation/matching/ordered selection/unmatched diagnostics. No unrelated runtime helpers.
- `/launcher`: `runPiRole(argv, cwd?, agentDir?)`, `LAUNCHER_USAGE`.

Pure discovery has no implicit contribution registry. A Pi consumer supplies the directories collected from its actual loaded extension set. Minimal contributor:

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

Consumers forwarding existing APIs can map independent error codes to their own errors, alias neutral option/types, delegate their central path helpers to `/paths`, and supply extra scoped directories at priority below 100. Parent tool/result/setup policy stays in the consumer. Preserve captured definitions and snapshots rather than re-resolving names during recovery.

## Native CLI

`pi-role` composes role files, shared settings and native argv, then spawns **one normal `pi` executable resolved through process PATH**, with inherited stdin/stdout/stderr. It does not create an SDK session, call Pi `main`, run preliminary Pi processes, or execute extension factories before spawn. No role forwards argv unchanged. Role/list/help scanning stops at `--`; prompts after it are untouched. `--list` and selected-role help use pure discovery with zero factories; unselected help additionally shows native Pi help with extension discovery/explicit extensions suppressed, so factories still do not run.

The native process owns interactive regular/fullscreen, print text/JSON, RPC, stdin, images/@files, sessions/resume/fork/export, provider/API-key/model/thinking and extension flags. Arguments remain native except the necessary role prompt/resource/tool composition. Role models and shared aliases become concrete `--model provider/model:thinking` argv without catalog validation before the final native extensions load. Explicit non-alias models are forwarded unchanged and never fall back to the role model. Native Pi can accept unknown IDs as custom models for known providers; native validation/transport decides their validity. Invalid providers fail in native Pi.

CLI **ignores shared and per-role `extensionSettings`**. It neither delivers `event.settings` nor exposes a settings bus channel. Programmatic consumers receive resolved settings and supply contributor directories from their own loaded extensions.

Enabled/authorized resource candidates come from pure package metadata. Skills are enumerated with a no-extension ResourceLoader; no contributor or selected-out factory runs. Extension selection becomes `--no-extensions` plus selected explicit paths (including native builtins). Skill selection becomes `--no-skills` plus selected skill files. Disabled resources and unauthorized explicit project paths are rejected before launch. Project authorization is explicit approve/no-approve, saved trust, then global `defaultProjectTrust: always`; otherwise denied. No executable trust prepass. Missing remote resource metadata is not installed by the launcher. Dynamic extension-contributed resources are outside this static selector enumeration.

### Tool contract

Role/shared `tools` selectors control **model-declared loadout**, not a universal permission/security sandbox. Registered deferred/codemode tools can remain callable through `ctx.executeTool()` even when not declared; hidden/model-only tools have Pi's native exposure semantics. Trusted extensions retain native capabilities.

Only when tool selectors need applying, the final Pi receives an explicit `--extension` for the packaged `dist/cli-tool-bridge.js`. Its private string flag carries four validated ordered selector layers. The bridge reuses selector validation/selection, obtains native `pi.getAllTools()`, and applies the loadout on `session_start` (including reload) and before agent turns. Malformed payloads visibly terminate startup with no open/default loadout. There are no global registries, provider/workflow registrations or persisted role SDK snapshots. Native reload propagates runtime flag values.

Explicit native `--tools` overrides role/shared loadout and is a hard allowlist ceiling, `--exclude-tools` is a hard exclusion, `--no-tools` absolutely wins, and `--no-builtin-tools` excludes builtin names while permitting eligible extension tools. Pi 1.0.x internally gives `tools` priority over `noTools` and treats `no-builtin-tools` as an initial loadout only. The selected launcher therefore appends an empty native `--tools` for no-tools, or merged builtin exclusions for no-builtin-tools. Native registry filtering, not merely a UI list, prevents reenabling excluded tools at startup, reload or later turns. In the tested 1.0.0/1.0.2 source, `_refreshToolRegistry` (the registry builder) filters definitions and callable `_toolRegistry` entries using `_isAllowedTool`; no-tools also empties `getAllTools()` in these versions. Enumeration alone is not a permission check.

### Native scope/prompt limits

`contextFiles: []` maps to native `--no-context-files`; all `[global, project, cwd]` scopes use native context discovery. Partial scopes fail explicitly as unsupported unless the user supplies `--no-context-files`. There is no `local` scope alias or context bridge. Programmatic resolution returns the requested scopes for the consumer to apply.

Role override prefixes use native `--system-prompt`, including an empty string. Pi cannot represent an exact initially empty prefix with stock argv: empty input retains native default-prefix semantics. The CLI does not install a prompt workaround. Nonoverride role text appends after native append resources. Explicit system/append prompt flags use native file/inline resolution. Native sessions persist native state, not role snapshots; relaunch resolves role files again. Signals are forwarded to native Pi; shutdown events follow native signal behavior (abrupt RPC signals need not emit shutdown).

### Pure programmatic options

`discoverRoles`, `resolveRole` and `composeRoleConfiguration` read role/settings files and return definitions or configuration options. They execute no extension factories, create no SDK model runtime, session manager, agent session or resource loader, and acquire no session/provider resources. Package metadata and event-bus contribution APIs remain available; consumers own the bus and loaded membership.

`resolveRole` returns the model, prompt mode/text, selector sources/layers, tools selected within consumer ceilings, selected skills/extensions, extension settings namespaces and context scopes. Consumers apply those options to their own runtime and own resource loading, settings delivery, context filtering, persistence and disposal. Captured definitions and configuration can be retained by the consumer with `useSharedSettings: false`; no package-owned session snapshot protocol is needed.

Tests cover pure resolution/composition, resource ceilings, consumer-captured configuration and contribution lifecycle, plus real native launches for factory-once/selected-out exclusion, pure list/help, aliases, wildcard loadouts/reload, explicit ceilings/reenable attempts, malformed boundary shutdown, context limits, stdin/native sessions, and local synthetic-provider model requests. Nested `ctx.executeTool()` verifies deferred/codemode calls under loadout-only selection; malicious model calls cannot invoke any exposure under no-tools. PTY smoke inspects selected/unselected regular TUI and selected fullscreen, exiting via Ctrl+D. Paid providers and external MCP servers are not tested.
