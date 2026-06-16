# Releasing

Distribution is via **GitHub Releases** — no marketplace, no accounts, no tokens.
Pushing a version tag builds the extension and attaches the `.vsix` to a GitHub
Release for users to download and install.

## Cutting a release
1. Bump `version` in `package.json` and add a matching `CHANGELOG.md` entry.
2. Commit, then tag and push:
   ```bash
   git tag v0.3.0
   git push origin v0.3.0
   ```
3. The **Release** workflow (`.github/workflows/release.yml`) builds, tests,
   packages, and creates a GitHub Release with `claude-task-tracker.vsix`
   attached. No secrets required.

## Build the VSIX locally (optional)
```bash
npm run build
npm run package   # produces claude-task-tracker.vsix
```

## Installing (for users)
Download `claude-task-tracker.vsix` from the
[Releases page](https://github.com/chadcoco1444/claude-task-tracker/releases), then:
- Command Palette → **Extensions: Install from VSIX…**, or
- `code --install-extension claude-task-tracker.vsix`

## Later: publishing to the VS Code Marketplace (optional)
If you ever want it searchable in the Marketplace, the simplest route is a web
upload at <https://marketplace.visualstudio.com/manage>: create publisher
`chadcoco1444`, then **New extension → Visual Studio Code** and upload the `.vsix`.
Automating it via CI would mean adding a `VSCE_PAT` secret and a `vsce publish`
step back into the release workflow.
