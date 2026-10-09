# pi-ext-roles

Reusable Markdown roles for Pi, with a native launcher and independent resolution APIs.

[Roles guide](docs/roles.md) | [Configuration](docs/roles.md#configuration-and-resolution) | [API](docs/roles.md#source-api) | [Native CLI](docs/roles.md#native-cli) | [Workflow adapter](docs/roles.md#optional-workflow-adapter)

Requires Node.js 22.19 or newer and Pi on `PATH` for the launcher. Roles and extensions are trusted configuration, not a security sandbox. Install only code you trust.

## Install

For role contributions in Pi:

```sh
pi install npm:@piewf/pi-ext-roles
```

For the standalone `pi-role` launcher:

```sh
npm install -g @piewf/pi-ext-roles
```

Upgrading from the old workflow CLI? See the [migration guide](docs/roles.md#migrating-from-workflow-owned-roles) before installing the binary.

## Quick start

```sh
pi-role --list
pi-role reviewer --identify   # print role file path and content
pi-role reviewer
pi-role scout -p "Where is the retry logic?"
```

Create `~/.pi/agent/pi-ext-roles/roles/code-reader.md`:

```markdown
---
description: Read code and report findings without editing
tools: ['!*', read, grep, find, ls]
---
Trace the relevant code and report concrete findings. Do not edit files.
```

Then run `pi-role code-reader`. Choose a model in Pi, with `--model`, or in the role file. See the [roles guide](docs/roles.md#write-your-first-role) for aliases, resource selectors and project roles.

## Included capabilities

Five model-free fallback roles: `developer`, `oracle`, `researcher`, `reviewer` and `scout`. Global and authorized project roles override those defaults.

`pi-role` applies a role and starts one normal Pi process. Native interactive, print/JSON, RPC and session behavior stay with Pi. See [CLI contracts and limits](docs/roles.md#native-cli).

Extensions contribute packaged roles with `registerRoleContribution`. Programmatic consumers use `discoverRoles`, `resolveRole` and `composeRoleConfiguration` to obtain definitions and options, then apply them through their own runtime. This package does not create SDK sessions or own their lifecycle.

For workflows, enable this Pi extension explicitly alongside workflows. Its optional
preparation hook preserves `agent('task', { role: 'reviewer' })` without making
workflows understand roles. The independent library and `pi-role` CLI do not
require workflows. See the [adapter and recovery contracts](docs/roles.md#optional-workflow-adapter).

## Development

```sh
npm ci
npm run check
npm run test:package
npm run test:terminal
```

Terminal checks require Python 3 and a Unix PTY. Publishing stays in [RELEASING.md](RELEASING.md).

## License

MIT
