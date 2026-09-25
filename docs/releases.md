# Releasing @origin89/cloud

Use Changesets for release notes and version bumps. A PR that changes the contract in `packages/cloud` includes a note from `pnpm changeset`. Worker-only changes that keep the contract need no note.

`publish-cloud.yml` runs on pushes to `main`. With pending changesets it opens or updates the `chore: release packages` PR, which applies versions, refreshes the lockfile and writes `packages/cloud/CHANGELOG.md`. Merging that PR builds, checks, packs and publishes the version through npm trusted publishing. Stable versions only; do not push release tags by hand.

`pnpm run package` builds the package and installs the tarball in a scratch project to check its exports, declarations and `schema.json`. The `Checks` workflow runs it on every PR.

## npm and GitHub setup

Configure the npm trusted publisher for organization `origin89hq`, repository `cloud`, workflow `publish-cloud.yml`, with no environment. Only the publish job has OIDC permission; no npm token is stored in GitHub. Packages are published with npm provenance. Actions must be allowed to create pull requests.

Release PRs opened with `GITHUB_TOKEN` need their `Checks` run approved before merging.

## Recovery

Fix a failed build in a PR. If npm rejects authentication, correct the trusted publisher and rerun the failed publish job. Never replace a published version or move a release tag.
