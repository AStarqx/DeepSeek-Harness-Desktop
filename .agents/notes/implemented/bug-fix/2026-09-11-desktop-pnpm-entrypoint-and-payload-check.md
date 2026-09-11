# Agent Note: Desktop package-manager entrypoints and the removed fs-ext payload check

Status: implemented

English | [中文](2026-09-11-desktop-pnpm-entrypoint-and-payload-check.zh.md)

## Problem

`pnpm run package:desktop:win:x64:unsigned` failed twice before electron-builder ran.

[Desktop packaging](../../../../apps/desktop/scripts/package-target.ts) and the [development launcher](../../../../apps/desktop/scripts/dev.ts) spawned `process.execPath` with `npm_execpath` as the program argument. A package manager that publishes its lifecycle entrypoint as an executable — pnpm sets `npm_execpath` to `pnpm.exe` on Windows — is not a JavaScript file, so Node refused the program with `ERR_UNKNOWN_FILE_EXTENSION` before any build step started. The [shared resolver](../../../../scripts/pnpm-invocation.ts) already distinguishes a JavaScript entrypoint from an executable one, and every other repository script with this need uses it.

[The payload smoke](../../../../apps/desktop/tests/fixtures/runtime-payload-smoke.mjs) then required `fs-ext` from the packaged runtime. The [prebuilt system primitives decision](../architecture/2026-09-07-prebuilt-system-primitives.md) replaced fs-ext's flock binding with `@deepseek-ai/node-addon-system/flock`, and no package declares fs-ext, so the assertion could not hold for any target. The fixture and the dependency migration arrived on separate branches, and Desktop packaging runs outside CI, so the mismatch reached the release command.

## Decision

Both Desktop scripts resolve the package-manager invocation through `pnpmInvocation`, which runs a JavaScript entrypoint under `process.execPath` and an executable entrypoint directly. Desktop now follows the repository-wide invocation pattern instead of owning a second copy of it.

The payload smoke checks the native and HTML payloads the bundled runtime still installs: koffi through `kernel32.dll`, sharp through libvips, the Turndown GFM converter, and node-pty through ConPTY. Removing a check follows removing its subject; the remaining four keep their existing coverage.

`pnpm-workspace.yaml` approves Electron's install script. The development launcher resolves its executable through `require('electron')`, which only answers when that script has downloaded the platform binary.

## Alternatives considered

**Special-case an executable entrypoint inside the Desktop scripts.** The repository already owns the distinction between entrypoint kinds, and a second copy would drift from the tested one.

**Require packaging to run under the pnpm version in `packageManager`.** A launcher must accept the entrypoint it is handed. A workstation whose environment disables managed package-manager versions is a supported way to invoke the command.

**Keep the fs-ext assertion.** No manifest declares fs-ext, so the assertion could only report the migration that removed it, not a defect in the packaged runtime.

## Consequences

Desktop packaging and the development launcher work when the package manager publishes either entrypoint kind, on any host.

`apps/desktop/scripts/runtime-file-policy.ts` and the generated project's `allowBuilds` list still name fs-ext. For the bundled runtime those entries are unreachable, and the generated list pre-approves a build a third-party plugin may still request.

Verification: the unsigned win-x64 target completed preparation, the payload smoke reported `koffi`, `sharp`, `html`, and `pty`, and electron-builder produced a runnable unpacked application.
