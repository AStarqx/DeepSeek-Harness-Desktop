/** In-window title bar that replaces the native menu bar and carries the application menu. */

import type { BrowserWindowConstructorOptions } from 'electron'
import { DESKTOP_BRAND_MARK, DESKTOP_BRAND_MARK_VIEWBOX } from './brand.ts'
import type { DesktopLocale } from './locale.ts'

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

/** Renderer transport the injected title bar uses to reach the shell's main process. */
export interface DesktopTitleBarTransport {
  /** Reads the shell locale that owns the application-menu label. */
  locale(): Promise<DesktopLocale>
  /** Opens the application menu below the button that reported the anchor. */
  openMenu(anchor: DesktopMenuAnchor): Promise<void>
  /** Reports the color of the window-control glyphs the system draws over the title bar. */
  reportSymbolColor(color: string): Promise<void>
}

/** Everything the injected title bar needs from its owning preload. */
export interface DesktopTitleBarOptions extends DesktopTitleBarTransport {
  /** Host platform, which decides whether the window owns its chrome at all. */
  readonly platform: NodeJS.Platform
}

const TITLE_BAR_CLASS = 'dsh-desktop-title-bar'
const BRAND_MARK_CLASS = 'dsh-desktop-title-bar-mark'
const MENU_BUTTON_CLASS = 'dsh-desktop-title-bar-menu'
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

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
  padding-inline: 10px 6px;
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
 * Validate an application-menu anchor reported by a renderer.
 * @param value - Untrusted anchor payload from the application-menu channel.
 * @returns The anchor rounded to whole content pixels.
 */
export function desktopMenuAnchor(value: unknown): DesktopMenuAnchor {
  const anchor = value as { readonly x?: unknown; readonly y?: unknown } | null
  const x = anchor?.x
  const y = anchor?.y
  if (typeof x !== 'number' || typeof y !== 'number'
    || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
    throw new Error('dsh desktop: application menu anchor must be a non-negative finite point')
  }
  return { x: Math.round(x), y: Math.round(y) }
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
    const install = (): void => { renderTitleBar(locale.messages.application, options) }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true })
    else install()
  }).catch((error: unknown) => { console.error(error) })
}

function renderTitleBar(label: string, transport: DesktopTitleBarTransport): void {
  if (document.querySelector(`.${TITLE_BAR_CLASS}`) !== null) return
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(TITLE_BAR_CSS)
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
  const bar = document.createElement('div')
  bar.className = TITLE_BAR_CLASS
  const button = document.createElement('button')
  button.type = 'button'
  button.className = MENU_BUTTON_CLASS
  button.textContent = label
  button.addEventListener('click', () => {
    const rect = button.getBoundingClientRect()
    void transport.openMenu({ x: Math.round(rect.left), y: Math.round(rect.bottom) })
  })
  bar.append(brandMark(document), button)
  document.body.append(bar)
  const publishSymbolColor = (): void => {
    void transport.reportSymbolColor(getComputedStyle(bar).color)
  }
  publishSymbolColor()
  new MutationObserver(publishSymbolColor).observe(document.body, { attributes: true })
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', publishSymbolColor)
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
