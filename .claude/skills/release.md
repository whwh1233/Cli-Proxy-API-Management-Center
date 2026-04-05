# Release Workflow

Every code push MUST include a release version tag to ensure remote resources are updated.

## Steps

1. **Stage and commit changes**
   ```bash
   git add <files>
   git commit -m "<commit message>"
   ```

2. **Determine next version**
   ```bash
   git tag --sort=-v:refname | head -1
   ```
   Bump the patch version (e.g. `v0.0.4` -> `v0.0.5`). For breaking changes bump minor/major accordingly.

3. **Create version tag**
   ```bash
   git tag v<next_version>
   ```

4. **Push commit and tag together**
   ```bash
   git push origin main --tags
   ```

5. **Verify** - The push of a `v*` tag triggers `.github/workflows/release.yml` which:
   - Builds the project (`npm run build`)
   - Renames `dist/index.html` to `management.html`
   - Creates a GitHub Release with `management.html` as the asset
   - Auto-generates release notes from commit log

## Important

- **Never push without a tag** - the remote deployment only updates when a new Release is created via tag push.
- Tag format must be `v*` (e.g. `v0.0.5`, `v1.0.0`).
- The `VERSION` env var is set to the tag name during build, so the built artifact includes the version info.
