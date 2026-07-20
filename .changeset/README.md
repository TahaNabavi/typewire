# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets).

To record a change for the next release:

```bash
pnpm changeset
```

Pick the affected packages and the bump type (patch/minor/major) and write a short
summary. On merge to `main`, the release workflow opens a "Version Packages" PR;
merging that PR publishes the changed packages to npm.
