# Releasing

This repository publishes `@piewf/pi-ext-roles`. Workflow consumer releases are separate.

## Verify

```sh
npm ci
npm run check
npm run test:package
npm run test:terminal
```

Review `git status` and the intended diff before committing. Do not include generated tarballs or temporary verification logs.

## Publish

Update the manifest and lockfile version, commit the release changes, and push a matching `vX.Y.Z` tag after publication approval.

`.github/workflows/publish.yml` checks the tag against the package version, runs tests and package/TUI checks, then publishes from GitHub Actions. Prereleases use the `next` dist-tag; stable releases use `latest`. Already published versions are skipped.

npm Trusted Publishing is configured for:

- Owner: `vekexasia`
- Repository: `pi-ext-roles`
- Workflow: `publish.yml`
- Environment: none
- Permission: `npm publish`

Publishing uses a GitHub-hosted runner, Node 24 and `id-token: write`, without a permanent npm token. npm generates provenance for the published artifact.

After Actions succeeds, verify the registry version and install it in an isolated consumer. npm processing can delay registry availability; an accepted upload is not proof that users can install it yet.
