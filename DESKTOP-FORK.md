# Desktop fork workflow

English | [中文](DESKTOP-FORK.zh.md)

This repository forks [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) to ship the Electron Desktop application to its own users. It keeps the upstream history so every upstream release can be merged, and it publishes its own Windows releases so an installed application can update itself.

## Remotes

| Remote | Repository | Purpose |
|---|---|---|
| `origin` | `deepseek-ai/deepseek-harness` | read-only upstream |
| `fork` | this repository | the code, builds, and releases users receive |

`.\scripts\update-desktop.ps1` finds both remotes by URL, so the script also works in a clone where `origin` is this repository and `upstream` is the DeepSeek repository.

## Sync upstream into this repository

```powershell
# Report what upstream changed and which files would conflict; change nothing.
.\scripts\update-desktop.ps1 -CheckOnly

# Merge upstream, install dependencies, package the unsigned Windows target, publish the branch.
.\scripts\update-desktop.ps1 -Push

# The same, and mirror the new artifacts into desktop-release\.
.\scripts\update-desktop.ps1 -Push -Publish
```

One pass backs up the current HEAD as `backup/desktop-<timestamp>`, fetches upstream (retrying three times), previews the files a merge would conflict on, merges or rebases, warns when `patches/`, `pnpm-workspace.yaml`, or `pnpm-lock.yaml` moved, runs `pnpm install`, packages `win-x64` unsigned, and pushes to `fork/master`. A conflict aborts the merge and leaves a clean tree unless `-KeepConflicts` is passed.

Files this fork owns are the ones upstream may also change, so a conflict is expected most often in the window chrome ([`apps/desktop/src/titlebar.ts`](apps/desktop/src/titlebar.ts), [`apps/desktop/src/brand.ts`](apps/desktop/src/brand.ts)) and in the update channel ([`apps/desktop/scripts/desktop-auto-update-environment.mjs`](apps/desktop/scripts/desktop-auto-update-environment.mjs), [`apps/desktop/electron-builder.config.mjs`](apps/desktop/electron-builder.config.mjs)).

## Release a Desktop update

1. Bump the shared dsh version, which rewrites the root manifest, `apps/desktop/package.json`, and the lockfile, and commits the bump: `pnpm run release:dsh -- 0.1.6`. Packaging rejects a mismatch between the two manifests.
2. Tag the release commit and push the tag: `git tag desktop-v0.1.6` and `git push fork desktop-v0.1.6`.
3. [`.github/workflows/desktop-release.yml`](.github/workflows/desktop-release.yml) builds the unsigned Windows target on a Windows runner and attaches the installer, its blockmap, and the channel metadata to a GitHub release whose tag matches the packaged version.
4. An installed application checks that release ten seconds after its main window opens, and on demand from **应用 → 检查更新…**. Accepting the prompt downloads and installs the release.

## The update channel

`DSH_DESKTOP_AUTO_UPDATE_ENV=github` selects repository-hosted releases and `DSH_DESKTOP_UPDATE_REPOSITORY=<owner>/<name>` names the repository, so a build carries updater configuration without DeepSeek's COS account or a code-signing identity. The packaged `resources/app-update.yml` then names the provider, and the release carries electron-builder's channel metadata — `latest.yml` — with the artifact digests the updater verifies. The packaging scripts refuse the GitHub deployment when they are asked for a COS upload destination.

Users must install one build from this repository before updates reach them: builds published by DeepSeek check DeepSeek's own release stream, so those installations never see these releases.

### Distribution notes

- Windows installers built here are unsigned, so SmartScreen warns on the first install and some users may need to allow the application.
- Automatic installation replaces an NSIS-installed application. A portable copy can check, download, and be updated by hand; `desktop-release\更新到新版.cmd` mirrors a new build over a portable copy without running the installer.
- Keep `DSH_DESKTOP_APP_ID` fixed across releases. It names the installed application, its shortcuts, and the updater cache; changing it installs a second application instead of upgrading this one.
- A prerelease version (for example `0.1.6-rc.1`) is published as a GitHub prerelease; only installations whose own version is a prerelease accept it. A stable version publishes as the latest release and reaches every installation. Prefer stable versions for updates all users should receive.
- The repository is private by default. A private repository cannot serve update downloads to other people, and its Actions minutes are billed: make it public before the first release.

## Upstream workflows

This repository also carries upstream's GitHub Actions workflows, which expect DeepSeek's runners, secrets, and release environment, so most of them fail on a fork. Disable them per workflow in the repository's **Actions** tab and keep `desktop-release.yml`, which needs nothing beyond the repository's own `GITHUB_TOKEN`.
