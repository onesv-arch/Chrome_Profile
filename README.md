# Chrome Profile Cloner

Desktop utility for Windows to clone Google Chrome profiles with bookmarks, installed extensions, and unpacked dev-mode extensions when their source folders still exist.

## Current state

- Modernized Electron desktop UI optimized for repeated desktop use.
- Profile discovery from Chrome `Local State`.
- Profile stats in the picker: bookmarks, extensions, unpacked extensions.
- Transactional clone flow with rollback if a clone run fails midway.
- Structured clone results, including warnings for missing unpacked extension source folders.
- Windows installer build via `electron-builder` and NSIS.
- Built-in update workflow using `electron-updater` against GitHub Releases.

## Important constraints

- Chrome must be fully closed before cloning.
- Best results are on the same Windows user account and the same machine.
- Some encrypted login/session data may still not survive cloning.
- Unpacked extension folders can only be preserved if the original source paths still exist at clone time.
- The app blocks update download/install while a clone run is active.

## Project structure

- `main.js`: Electron main process, IPC, desktop shell
- `preload.js`: secure renderer bridge
- `src/core/chromeCloneService.js`: profile discovery, cloning, warnings, rollback
- `src/core/updateService.js`: GitHub update channel, updater events, install flow
- `src/renderer/`: UI layout, styles, renderer logic
- `electron-builder.config.cjs`: shared build and publish config
- `.github/workflows/release.yml`: GitHub Actions release pipeline
- `tests/`: Node test suite for core clone helpers

## Local development

Install dependencies:

```powershell
npm.cmd install
```

Start the desktop app:

```powershell
npm.cmd start
```

Run tests:

```powershell
node --test
```

## Packaging

Build a Windows installer locally:

```powershell
npm.cmd run dist
```

Current installer output:

- `release\Chrome Profile Cloner-Setup-0.1.0.exe`

Build an unpacked Windows app directory:

```powershell
npm.cmd run pack
```

## GitHub update configuration

Edit `app-update-config.json`:

```json
{
  "provider": "github",
  "owner": "your-github-owner",
  "repo": "your-github-repo",
  "private": false,
  "vPrefixedTagName": true,
  "releaseType": "release",
  "channel": "latest",
  "host": "github.com"
}
```

This same file is used for:

- in-app update checks
- `electron-builder` publish target resolution

The app reads this config from the first available location:

1. Electron `userData`\app-update-config.json
2. bundled `app-update-config.json`
3. project root `app-update-config.json`

## GitHub release flow

One-time setup:

1. Replace placeholders in `app-update-config.json`
2. Replace the placeholder `repository.url` in `package.json`
3. Push this project to the target GitHub repository

Manual local publish to GitHub Releases:

```powershell
npm.cmd run publish:github
```

This requires a GitHub token in the environment:

```powershell
$env:GH_TOKEN="your_github_token"
```

For each release:

1. Increase `version` in `package.json`
2. Commit changes
3. Create and push a version tag such as `v0.1.1`
4. GitHub Actions runs `.github/workflows/release.yml`
5. The workflow publishes these assets to GitHub Releases:
   - `Chrome Profile Cloner-Setup-x.y.z.exe`
   - `latest.yml`
   - `*.blockmap`
6. Installed apps can click `Check updates` and pull directly from GitHub

## Notes on private repositories

- Public GitHub repos are the simplest path.
- Private auto-update needs extra token handling on client machines, so this setup currently targets public releases first.

## Next steps

- Add per-profile custom target names instead of suffix-only naming.
- Add a dedicated installer/app icon instead of the default Electron icon.
- Add optional post-clone launch into the new Chrome profile.
- Add richer clone diagnostics for extension storage and sync state.
