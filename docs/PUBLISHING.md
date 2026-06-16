# Publishing

Releases go out via GitHub Actions on a version tag. This is the one-time
account setup and the per-release flow.

## One-time setup

### VS Code Marketplace
1. Create an Azure DevOps organization at <https://dev.azure.com> (if you don't have one).
2. Create the publisher `chadcoco1444` at
   <https://marketplace.visualstudio.com/manage/createpublisher>. The Publisher ID
   MUST equal the `publisher` field in `package.json`.
3. In Azure DevOps → User settings → Personal Access Tokens, create a PAT with
   scope **Marketplace → Manage** and organization **All accessible organizations**.
4. Add it as a GitHub repo secret named `VSCE_PAT`
   (Settings → Secrets and variables → Actions).

## Cutting a release
1. Bump `version` in `package.json` and add a matching `CHANGELOG.md` entry.
2. Commit, then tag and push:
   ```bash
   git tag v0.3.0
   git push origin v0.3.0
   ```
3. The **Release** workflow builds, tests, packages, publishes to the VS Code
   Marketplace, and attaches the `.vsix` to the GitHub Release.

## First-release validation (optional)
Before relying on CI, publish once locally to confirm your tokens work:
```bash
npm run build
npx vsce package --no-dependencies
npx vsce publish --no-dependencies -p <VSCE_PAT>
```
