/** In-window title bar that replaces the native menu bar and carries the application menu. */

import type { BrowserWindowConstructorOptions } from 'electron'
import { DESKTOP_BRAND_MARK, DESKTOP_BRAND_MARK_VIEWBOX } from './brand.ts'
import { formatDesktopMessage, type DesktopLocale } from './locale.ts'
import { DESKTOP_IPC, type DesktopUpdateState } from './ipc.ts'

/** Height of the Desktop title bar in CSS pixels. */
export const DESKTOP_TITLE_BAR_HEIGHT = 36

/** Width of the brand mark in the title bar in CSS pixels. */
export const DESKTOP_BRAND_MARK_WIDTH = 20

/** Window-controls color that lets the application paint its own title bar background. */
export const DESKTOP_TITLE_BAR_OVERLAY_COLOR = '#00000000'

/** Window-controls color before a renderer reports the color of its own title bar copy. */
export const DESKTOP_TITLE_BAR_SYMBOL_COLOR = '#0f1115'

/** Application menu anchor in the window's content coordinates. */
export interface DesktopMenuAnchor {
  /** Distance from the content area's left edge in CSS pixels. */
  readonly x: number
  /** Distance from the content area's top edge in CSS pixels. */
  readonly y: number
}

/** Menus the title bar offers, each rendered by the main process as a native popup. */
export type DesktopMenuId = 'application' | 'help'

/** One request to open a title-bar menu below the button that owns it. */
export interface DesktopMenuRequest extends DesktopMenuAnchor {
  /** Menu the pressed button owns. */
  readonly menu: DesktopMenuId
}

/** How the title bar reports its own colors to the shell. */
export interface DesktopTitleBarAppearance {
  /** Color of the window-control glyphs the system draws over the title bar. */
  readonly symbolColor: string
  /** Whether the document renders a dark surface, which also themes native shell menus. */
  readonly dark: boolean
}

/** Renderer transport the injected title bar uses to reach the shell's main process. */
export interface DesktopTitleBarTransport {
  /** Reads the shell locale that owns the title bar's copy. */
  locale(): Promise<DesktopLocale>
  /** Opens one title-bar menu below the button that reported the anchor. */
  openMenu(request: DesktopMenuRequest): Promise<void>
  /** Reports the title bar's own colors. */
  reportAppearance(appearance: DesktopTitleBarAppearance): Promise<void>
  /** Reads and drives the Desktop release stream the title bar reports on. */
  readonly updates: DesktopUpdateTransport
}

/** Renderer transport for the Desktop release stream. */
export interface DesktopUpdateTransport {
  /** Reads the current update state, so a window opened later renders it. */
  status(): Promise<DesktopUpdateState>
  /** Subscribes to update states; the returned disposer removes the listener. */
  subscribe(listener: (state: DesktopUpdateState) => void): () => void
  /** Downloads and installs the retained release. */
  install(): Promise<void>
  /** Checks the release stream again. */
  check(): Promise<void>
}

/** The Electron IPC surface both Desktop preloads use for the release stream. */
export interface DesktopIpcBridge {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  on(channel: string, listener: (event: unknown, state: DesktopUpdateState) => void): void
  off(channel: string, listener: (event: unknown, state: DesktopUpdateState) => void): void
}

/**
 * Build the release-stream transport over the shell's own IPC channels.
 * @param ipc - Renderer IPC bridge of the owning preload.
 * @returns Transport the injected title bar renders update states from.
 */
export function desktopUpdateTransport(ipc: DesktopIpcBridge): DesktopUpdateTransport {
  return {
    status: () => ipc.invoke(DESKTOP_IPC.updatesStatus) as Promise<DesktopUpdateState>,
    subscribe(listener) {
      const handle = (_event: unknown, state: DesktopUpdateState): void => { listener(state) }
      ipc.on(DESKTOP_IPC.updatesState, handle)
      return () => { ipc.off(DESKTOP_IPC.updatesState, handle) }
    },
    install: async () => { await ipc.invoke(DESKTOP_IPC.updatesInstall) },
    check: async () => { await ipc.invoke(DESKTOP_IPC.updatesCheck) },
  }
}

/** Everything the injected title bar needs from its owning preload. */
export interface DesktopTitleBarOptions extends DesktopTitleBarTransport {
  /** Host platform, which decides whether the window owns its chrome at all. */
  readonly platform: NodeJS.Platform
}

const TITLE_BAR_CLASS = 'dsh-desktop-title-bar'
const BRAND_MARK_CLASS = 'dsh-desktop-title-bar-mark'
const MENU_BUTTON_CLASS = 'dsh-desktop-title-bar-menu'
const UPDATE_CLASS = 'dsh-desktop-title-bar-update'
const UPDATE_ICON_CLASS = 'dsh-desktop-title-bar-update-icon'
const UPDATE_LABEL_CLASS = 'dsh-desktop-title-bar-update-label'
const UPDATE_BAR_CLASS = 'dsh-desktop-title-bar-update-bar'
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

/* The system draws its window controls over the page, so the badge keeps clear of that strip. */
const WINDOW_CONTROLS_WIDTH = 150

/*
 * Adopted stylesheets are the one styling route the shell documents admit: their
 * `style-src 'self'` policies reject <style> elements and style attributes.
 * The page offset reserves the bar's row, and every window keeps the page
 * background behind both the bar and the system-drawn window controls.
 */
const TITLE_BAR_CSS = `html { height: 100% !important; }
body {
  box-sizing: border-box !important;
  height: 100% !important;
  min-height: 0 !important;
  padding-top: ${DESKTOP_TITLE_BAR_HEIGHT}px !important;
}
.${TITLE_BAR_CLASS} {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  box-sizing: border-box;
  height: ${DESKTOP_TITLE_BAR_HEIGHT}px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 ${WINDOW_CONTROLS_WIDTH}px 0 10px;
  background: transparent;
  color: inherit;
  user-select: none;
  z-index: 2147483000;
  -webkit-app-region: drag;
}
.${BRAND_MARK_CLASS} {
  flex: none;
  display: block;
}
.${UPDATE_CLASS} {
  -webkit-app-region: no-drag;
  margin-left: auto;
  display: none;
  align-items: center;
  gap: 7px;
  position: relative;
  overflow: hidden;
  padding: 4px 12px;
  border: 0;
  border-radius: 999px;
  background: #4d6bfe;
  color: #ffffff;
  font: inherit;
  font-size: 12px;
  line-height: 1.3;
  white-space: nowrap;
  cursor: pointer;
}
.${UPDATE_CLASS}[data-visible] { display: flex; }
.${UPDATE_CLASS}[data-phase='checking'],
.${UPDATE_CLASS}[data-phase='installing'],
.${UPDATE_CLASS}[data-phase='ready'],
.${UPDATE_CLASS}[data-phase='downloading'] { cursor: default; }
.${UPDATE_CLASS}[data-phase='error'] { background: transparent; color: inherit; box-shadow: inset 0 0 0 1px currentColor; }
.${UPDATE_CLASS}:hover { filter: brightness(1.08); }
.${UPDATE_CLASS}:disabled { opacity: 1; }
.${UPDATE_CLASS}:disabled:hover { filter: none; }
.${UPDATE_CLASS}[data-phase='error']:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.08)); }
.${UPDATE_ICON_CLASS} { flex: none; display: block; }
.${UPDATE_LABEL_CLASS} { position: relative; }
.${UPDATE_BAR_CLASS} {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 2px;
  width: 0;
  background: #ffffff;
  transition: width 0.2s linear;
}
.${UPDATE_CLASS}[data-phase='checking'] .${UPDATE_ICON_CLASS} { animation: dsh-desktop-update-spin 1.1s linear infinite; }
@keyframes dsh-desktop-update-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .${UPDATE_CLASS}[data-phase='checking'] .${UPDATE_ICON_CLASS} { animation: none; }
  .${UPDATE_BAR_CLASS} { transition: none; }
}
.${MENU_BUTTON_CLASS} {
  -webkit-app-region: no-drag;
  margin: 0;
  padding: 4px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  line-height: 1.3;
  cursor: default;
}
.${MENU_BUTTON_CLASS}:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.08)); }
.${MENU_BUTTON_CLASS}:active { background: var(--dsw-alias-interactive-bg-hover-solid, rgba(38, 49, 72, 0.14)); }
.${MENU_BUTTON_CLASS}:focus-visible { outline: 2px solid #4d6bfe; outline-offset: -2px; }`

/**
 * Report whether a platform's windows carry the shell's own title bar and application menu.
 * @param platform - Host platform of the running shell.
 * @returns True where the native menu bar would occupy a second chrome row.
 */
export function desktopOwnsWindowChrome(platform: NodeJS.Platform): boolean {
  return platform !== 'darwin'
}

/**
 * Window chrome that hides the native title bar and leaves the window controls to the system.
 * @returns Browser window options for a shell that renders its own title bar.
 */
export function desktopTitleBarChrome(): BrowserWindowConstructorOptions {
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: DESKTOP_TITLE_BAR_OVERLAY_COLOR,
      symbolColor: DESKTOP_TITLE_BAR_SYMBOL_COLOR,
      height: DESKTOP_TITLE_BAR_HEIGHT,
    },
  }
}

/**
 * Validate one title-bar menu request reported by a renderer.
 * @param value - Untrusted payload from the application-menu channel.
 * @returns The menu the pressed button owns and the anchor rounded to whole content pixels.
 */
export function desktopMenuRequest(value: unknown): DesktopMenuRequest {
  const request = value as { readonly menu?: unknown; readonly x?: unknown; readonly y?: unknown } | null
  const menu = request?.menu
  const x = request?.x
  const y = request?.y
  if (menu !== 'application' && menu !== 'help') {
    throw new Error('dsh desktop: title-bar menu must be the application or help menu')
  }
  if (typeof x !== 'number' || typeof y !== 'number'
    || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
    throw new Error('dsh desktop: application menu anchor must be a non-negative finite point')
  }
  return { menu, x: Math.round(x), y: Math.round(y) }
}

/**
 * Validate the appearance a renderer reports for its own title bar.
 * @param value - Untrusted payload from the title-bar appearance channel.
 * @returns The window-control color and whether the document renders a dark surface.
 */
export function desktopTitleBarAppearance(value: unknown): DesktopTitleBarAppearance {
  const appearance = value as { readonly symbolColor?: unknown; readonly dark?: unknown } | null
  if (typeof appearance?.dark !== 'boolean') {
    throw new Error('dsh desktop: title-bar appearance must report whether the surface is dark')
  }
  return { symbolColor: desktopSymbolColor(appearance.symbolColor), dark: appearance.dark }
}

/**
 * Validate a window-control glyph color reported by a renderer.
 * @param value - Untrusted color payload from the title-bar channel.
 * @returns The rendered color accepted by the window controls overlay.
 */
export function desktopSymbolColor(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:#[0-9a-fA-F]{6}|rgba?\([\d.,\s]+\))$/.test(value)) {
    throw new Error('dsh desktop: window-control color must be a rendered rgb() or #rrggbb color')
  }
  return value
}

/**
 * Render the title bar into the current document.
 * @param options - Host platform plus the locale reader and main-process operations of the owning preload.
 */
export function installDesktopTitleBar(options: DesktopTitleBarOptions): void {
  if (!desktopOwnsWindowChrome(options.platform)) return
  void options.locale().then((locale) => {
    const install = (): void => { renderTitleBar(locale, options) }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true })
    else install()
  }).catch((error: unknown) => { console.error(error) })
}

function renderTitleBar(locale: DesktopLocale, transport: DesktopTitleBarTransport): void {
  if (document.querySelector(`.${TITLE_BAR_CLASS}`) !== null) return
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(TITLE_BAR_CSS)
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
  const bar = document.createElement('div')
  bar.className = TITLE_BAR_CLASS
  bar.append(
    brandMark(document),
    menuButton(document, locale.messages.application, 'application', transport),
    menuButton(document, locale.messages.helpMenu, 'help', transport),
    updateBadge(document, locale, transport.updates),
  )
  document.body.append(bar)
  const publishAppearance = (): void => {
    void transport.reportAppearance({
      symbolColor: getComputedStyle(bar).color,
      dark: rendersDarkSurface(document),
    })
  }
  publishAppearance()
  new MutationObserver(publishAppearance).observe(document.body, { attributes: true })
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', publishAppearance)
}

/** Build one title-bar menu button. */
function menuButton(
  document: Document,
  label: string,
  menu: DesktopMenuId,
  transport: DesktopTitleBarTransport,
): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = MENU_BUTTON_CLASS
  button.textContent = label
  button.addEventListener('click', () => {
    const rect = button.getBoundingClientRect()
    void transport.openMenu({ menu, x: Math.round(rect.left), y: Math.round(rect.bottom) })
  })
  return button
}

/**
 * Report whether the document paints a dark surface.
 *
 * The first painted background wins: a client page themes its body, while a shell document
 * themes the root element and leaves the body transparent.
 * @param document - Document whose surface is measured.
 * @returns True when the resolved background is darker than mid grey.
 */
function rendersDarkSurface(document: Document): boolean {
  const backgrounds = [document.body, document.documentElement]
  for (const element of backgrounds) {
    const color = getComputedStyle(element).backgroundColor
    const channels = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(color)
    if (channels === null) continue
    const alpha = channels[4] === undefined ? 1 : Number(channels[4])
    if (alpha === 0) continue
    const luminance = 0.2126 * Number(channels[1]) + 0.7152 * Number(channels[2]) + 0.0722 * Number(channels[3])
    return luminance < 128
  }
  return matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * Render the release indicator and keep it current.
 *
 * The badge is the shell's only passive update surface: it appears when a release is
 * available or when the user asked for a check, and it reports download progress in place.
 */
function updateBadge(document: Document, locale: DesktopLocale, updates: DesktopUpdateTransport): HTMLButtonElement {
  const badge = document.createElement('button')
  badge.type = 'button'
  badge.className = UPDATE_CLASS
  const icon = document.createElementNS(SVG_NAMESPACE, 'svg')
  icon.setAttribute('class', UPDATE_ICON_CLASS)
  icon.setAttribute('viewBox', '0 0 16 16')
  icon.setAttribute('width', '13')
  icon.setAttribute('height', '13')
  icon.setAttribute('aria-hidden', 'true')
  const glyph = document.createElementNS(SVG_NAMESPACE, 'path')
  glyph.setAttribute('fill', 'currentColor')
  // An arrow into a tray for an available update, a ring for a check in flight.
  const progress = document.createElement('span')
  progress.className = UPDATE_BAR_CLASS
  const label = document.createElement('span')
  label.className = UPDATE_LABEL_CLASS
  let phase: DesktopUpdateState['phase'] = 'idle'

  const render = (state: DesktopUpdateState): void => {
    phase = state.phase
    const messages = locale.messages
    const version = state.version ?? ''
    const percent = state.progress?.percent ?? 0
    const copy: Record<DesktopUpdateState['phase'], string> = {
      idle: '',
      checking: messages.updateBadgeChecking,
      available: formatDesktopMessage(messages.updateBadgeAvailable, { version }),
      downloading: formatDesktopMessage(messages.updateBadgeDownloading, { percent: String(percent) }),
      installing: messages.updateBadgeInstalling,
      ready: messages.updateBadgeReady,
      error: messages.updateBadgeFailed,
    }
    const text = copy[state.phase]
    label.textContent = text
    if (text === '') badge.removeAttribute('data-visible')
    else badge.setAttribute('data-visible', '')
    badge.setAttribute('data-phase', state.phase)
    badge.title = state.phase === 'available'
      ? formatDesktopMessage(messages.updateBadgeAvailableHint, { version })
      : text
    badge.disabled = state.phase !== 'available' && state.phase !== 'error'
    // CSSOM properties, not a style attribute: the shell documents reject inline styles.
    progress.style.width = `${String(state.phase === 'downloading' ? percent : 0)}%`
    glyph.setAttribute('d', state.phase === 'available'
      ? 'M8 1.5v8.1l3-3 1.1 1.1L8 12 3.9 7.7 5 6.6l3 3V1.5zM2.5 13h11v1.5h-11z'
      : 'M8 2.2a5.8 5.8 0 1 0 5.8 5.8h1.5A7.3 7.3 0 1 1 8 .7v1.5z')
  }

  badge.append(icon, label, progress)
  icon.append(glyph)
  badge.addEventListener('click', () => {
    if (phase === 'available') void updates.install()
    else if (phase === 'error') void updates.check()
  })
  updates.subscribe(render)
  void updates.status().then(render).catch((error: unknown) => { console.error(error) })
  return badge
}

/** Draw the DeepSeek mark in the title bar's own text color. */
function brandMark(document: Document): SVGSVGElement {
  const mark = document.createElementNS(SVG_NAMESPACE, 'svg')
  mark.setAttribute('class', BRAND_MARK_CLASS)
  mark.setAttribute('viewBox', `0 0 ${DESKTOP_BRAND_MARK_VIEWBOX.width} ${DESKTOP_BRAND_MARK_VIEWBOX.height}`)
  mark.setAttribute('width', String(DESKTOP_BRAND_MARK_WIDTH))
  mark.setAttribute('height', String(Math.round(DESKTOP_BRAND_MARK_WIDTH * (DESKTOP_BRAND_MARK_VIEWBOX.height / DESKTOP_BRAND_MARK_VIEWBOX.width) * 100) / 100))
  mark.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(SVG_NAMESPACE, 'path')
  path.setAttribute('d', DESKTOP_BRAND_MARK)
  path.setAttribute('fill', 'currentColor')
  mark.append(path)
  return mark
}
