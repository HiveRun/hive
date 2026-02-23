# Changesets

Use Changesets to manage version bumps and release notes for Hive.

## Create a changeset

```bash
bun run changeset
```

Commit the generated markdown file in `.changeset/` with your code changes.

## Apply version bumps

```bash
bun run version-packages
```

This updates `package.json` versions and creates changelog updates (if enabled).

## Tag a release

```bash
bun run release:tag
git push origin --follow-tags
```

Pushing a `v*` tag triggers the release workflow that publishes installer assets to GitHub Releases.
