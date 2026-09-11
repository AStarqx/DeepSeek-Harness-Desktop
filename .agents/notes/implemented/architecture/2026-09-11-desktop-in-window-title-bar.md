# Agent Note: Desktop in-window title bar, brand mark, and application icon

Status: implemented

English | [中文](2026-09-11-desktop-in-window-title-bar.zh.md)

## Problem

The shell set a native application menu, and Electron renders that menu as its own row below the window title bar. Windows and Linux therefore showed two chrome rows: the title bar carrying the session document title, and a single-item **应用** menu bar beneath it. The window also shipped no icon, so the taskbar, the installer, and the window itself stayed on Electron's default artwork while the client draws the DeepSeek mark.

## Decision

[`desktopOwnsWindowChrome`](../../../../apps/desktop/src/titlebar.ts) reports whether the shell carries the application menu in its own title bar. Every platform except macOS does; macOS keeps that menu in the system menu bar, where the platform expects it.

Windows and Linux windows set `titleBarStyle: 'hidden'` with a `titleBarOverlay` of the bar's height and a transparent color. The system keeps drawing the minimize, maximize, and close controls over the page, so the window loses its title text and keeps native control behavior, including snap layouts and high-contrast rendering.

Each window's preload injects the bar through `installDesktopTitleBar`: the DeepSeek mark as inline SVG in the document's own text color, one button labeled by the shell locale's `application` copy, a drag region, and a page offset that reserves the bar's row. The button opens the application menu, which the main process builds once and pops up at the anchor the button reports. The renderer reports the bar's rendered text color, and the main process applies it as the window-control symbol color so those controls stay legible after a theme change.

The bar styles itself through a stylesheet adopted with the CSSOM. The shell documents declare `style-src 'self'`, which rejects `<style>` elements and style attributes; an adopted stylesheet is not subject to that policy.

The application icon is rendered from the repository's own whale geometry (`FISH_LOGO_PATH`): `apps/desktop/build/icon.png` and `icon.ico` for electron-builder's Windows, macOS, and Linux targets, and `apps/desktop/renderer/app-icon.png` for the window icon of a running application.

## Alternatives considered

**Hide the native menu bar with `autoHideMenuBar`.** The row returns whenever a user presses Alt, and the menu still has no place in the title bar, so the two-row header stays one keystroke away.

**Draw the window controls in a frameless window.** Custom controls lose the system snap layouts, high-contrast rendering, and platform accessibility of the native controls, and they would need their own IPC surface for minimize, maximize, and close.

**Report an opaque overlay color instead of a transparent one.** The page already paints that region, and only the glyph color has to follow the theme, so an opaque color would add a second source of truth for the same pixels.

**Keep the document title in the window bar.** The client already draws the session title in its own header, so the window bar repeated it.

## Consequences

The window shows one chrome row. The session title no longer appears in the window bar; the client still sets `document.title` for platform surfaces that read it.

Every shell document is offset by the bar's height, including the startup page, the plugin manager, and the recovery document, so no page content sits under the system controls.

The shell owns a copy of the whale path in `apps/desktop/src/brand.ts`, because a window-chrome document cannot import a browser plugin package. `packages/client/ui-primitives/src/FishLogo.tsx` remains the visual source of record.

Verification: the running development application showed one bar with the mark, the localized menu, and the system controls; pressing the menu button opened the native menu; a theme switch updated the reported control color; the window's icon handle returned the whale tile. Specs cover the renderer installation, the anchor and color validation, both preload transports, and the window chrome options.
