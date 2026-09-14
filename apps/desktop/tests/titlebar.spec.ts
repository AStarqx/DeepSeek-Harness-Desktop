// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DESKTOP_BRAND_MARK, DESKTOP_BRAND_MARK_VIEWBOX } from '../src/brand.ts'
import {
  DESKTOP_TITLE_BAR_HEIGHT,
  DESKTOP_TITLE_BAR_OVERLAY_COLOR,
  DESKTOP_TITLE_BAR_SYMBOL_COLOR,
  desktopMenuAnchor,
  desktopOwnsWindowChrome,
  desktopSymbolColor,
  desktopTitleBarChrome,
  installDesktopTitleBar,
} from '../src/titlebar.ts'
import { resolveDesktopLocale } from '../src/locale.ts'
import type { DesktopUpdateState } from '../src/ipc.ts'

const LOCALE = resolveDesktopLocale('zh-CN')

function transport(platform: NodeJS.Platform = 'win32') {
  const openMenu = vi.fn(() => Promise.resolve())
  const reportSymbolColor = vi.fn(() => Promise.resolve())
  const updates = {
    status: vi.fn(() => Promise.resolve<DesktopUpdateState>({ phase: 'idle' })),
    subscribe: vi.fn((_listener: (state: DesktopUpdateState) => void) => () => {}),
    install: vi.fn(() => Promise.resolve()),
    check: vi.fn(() => Promise.resolve()),
  }
  return {
    platform,
    locale: vi.fn(() => Promise.resolve(LOCALE)),
    openMenu,
    reportSymbolColor,
    updates,
  }
}

/** Drive the update badge the title bar subscribed to. */
function publishUpdateState(underTest: ReturnType<typeof transport>, state: DesktopUpdateState): void {
  const listener = underTest.updates.subscribe.mock.calls[0]?.[0]
  if (listener === undefined) throw new Error('the title bar did not subscribe to update states')
  listener(state)
}

function updateBadge(): HTMLButtonElement {
  const badge = titleBar().querySelector<HTMLButtonElement>('.dsh-desktop-title-bar-update')
  if (badge === null) throw new Error('the title bar has no update badge')
  return badge
}

function titleBar(): HTMLElement {
  const bar = document.querySelector<HTMLElement>('.dsh-desktop-title-bar')
  if (bar === null) throw new Error('the title bar was not installed')
  return bar
}

function menuButton(): HTMLButtonElement {
  const button = titleBar().querySelector<HTMLButtonElement>('button')
  if (button === null) throw new Error('the title bar has no menu button')
  return button
}

beforeEach(() => {
  document.body.innerHTML = ''
  document.body.removeAttribute('data-ds-dark-theme')
  Object.defineProperty(document, 'adoptedStyleSheets', { value: [], writable: true, configurable: true })
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn() })))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('desktop window chrome', () => {
  it('owns the title bar everywhere except macOS', () => {
    expect(desktopOwnsWindowChrome('darwin')).toBe(false)
    expect(desktopOwnsWindowChrome('win32')).toBe(true)
    expect(desktopOwnsWindowChrome('linux')).toBe(true)
  })

  it('hides the native title bar and leaves the window controls to the system', () => {
    expect(desktopTitleBarChrome()).toEqual({
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: DESKTOP_TITLE_BAR_OVERLAY_COLOR,
        symbolColor: DESKTOP_TITLE_BAR_SYMBOL_COLOR,
        height: DESKTOP_TITLE_BAR_HEIGHT,
      },
    })
  })
})

describe('desktop title bar renderer reports', () => {
  it('rounds a menu anchor to whole content pixels', () => {
    expect(desktopMenuAnchor({ x: 12.4, y: 36.6 })).toEqual({ x: 12, y: 37 })
  })

  it.each([
    ['a negative coordinate', { x: -1, y: 0 }],
    ['a missing coordinate', { x: 0 }],
    ['a non-numeric coordinate', { x: '4', y: 0 }],
    ['a non-finite coordinate', { x: Number.POSITIVE_INFINITY, y: 0 }],
    ['an absent payload', undefined],
  ])('rejects %s', (_label, anchor) => {
    expect(() => desktopMenuAnchor(anchor)).toThrow(/application menu anchor/)
  })

  it.each(['rgb(237, 237, 240)', 'rgba(15, 17, 21, 0.5)', '#0f1115'])('accepts %s', (color) => {
    expect(desktopSymbolColor(color)).toBe(color)
  })

  it.each([['injected'], ['url(https://example.test/x.png)'], ['']])('rejects %j', (color) => {
    expect(() => desktopSymbolColor(color)).toThrow(/window-control color/)
  })
})

describe('desktop title bar installation', () => {
  it('renders the DeepSeek mark, the localized menu button, and reserves the bar row', async () => {
    const bar = transport()
    installDesktopTitleBar(bar)
    await vi.waitFor(() => { expect(document.querySelector('.dsh-desktop-title-bar')).not.toBeNull() })
    const mark = titleBar().querySelector('svg')
    expect(mark?.getAttribute('class')).toBe('dsh-desktop-title-bar-mark')
    expect(mark?.getAttribute('viewBox')).toBe(`0 0 ${DESKTOP_BRAND_MARK_VIEWBOX.width} ${DESKTOP_BRAND_MARK_VIEWBOX.height}`)
    expect(mark?.querySelector('path')?.getAttribute('d')).toBe(DESKTOP_BRAND_MARK)
    expect(titleBar().firstElementChild).toBe(mark)
    expect(menuButton().textContent).toBe(LOCALE.messages.application)
    expect(bar.openMenu).not.toHaveBeenCalled()
  })

  it('leaves a macOS window to its native chrome', async () => {
    const bar = transport('darwin')
    installDesktopTitleBar(bar)
    await Promise.resolve()
    expect(bar.locale).not.toHaveBeenCalled()
    expect(document.querySelector('.dsh-desktop-title-bar')).toBeNull()
  })

  it('ignores a second installation in the same document', async () => {
    installDesktopTitleBar(transport())
    await vi.waitFor(() => { expect(document.querySelector('.dsh-desktop-title-bar')).not.toBeNull() })
    installDesktopTitleBar(transport())
    await Promise.resolve()
    expect(document.querySelectorAll('.dsh-desktop-title-bar')).toHaveLength(1)
  })

  it('opens the application menu below the button that was pressed', async () => {
    const bar = transport()
    installDesktopTitleBar(bar)
    await vi.waitFor(() => { expect(document.querySelector('.dsh-desktop-title-bar')).not.toBeNull() })
    vi.spyOn(menuButton(), 'getBoundingClientRect').mockReturnValue({
      left: 6.5, right: 54, top: 0, bottom: 28.4, width: 47.5, height: 28.4, x: 6.5, y: 0, toJSON: () => ({}),
    })
    menuButton().click()
    expect(bar.openMenu).toHaveBeenCalledWith({ x: 7, y: 28 })
  })

  it('reports the window-control color again when the document theme changes', async () => {
    const bar = transport()
    installDesktopTitleBar(bar)
    await vi.waitFor(() => { expect(document.querySelector('.dsh-desktop-title-bar')).not.toBeNull() })
    expect(bar.reportSymbolColor).toHaveBeenCalledTimes(1)
    document.body.setAttribute('data-ds-dark-theme', '')
    await vi.waitFor(() => { expect(bar.reportSymbolColor).toHaveBeenCalledTimes(2) })
  })

  it('reports a renderer failure instead of throwing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const bar = transport()
    bar.locale.mockRejectedValueOnce(new Error('locale unavailable'))
    installDesktopTitleBar(bar)
    await vi.waitFor(() => { expect(error).toHaveBeenCalled() })
    expect(document.querySelector('.dsh-desktop-title-bar')).toBeNull()
  })
})

describe('desktop title bar update badge', () => {
  it('stays hidden while no update needs attention', async () => {
    const bar = transport()
    installDesktopTitleBar(bar)
    await vi.waitFor(() => { expect(document.querySelector('.dsh-desktop-title-bar')).not.toBeNull() })
    expect(updateBadge().getAttribute('data-visible')).toBeNull()
    expect(bar.updates.subscribe).toHaveBeenCalledOnce()
  })

  it('announces an available release and installs it when pressed', async () => {
    const bar = transport()
    installDesktopTitleBar(bar)
    await vi.waitFor(() => { expect(document.querySelector('.dsh-desktop-title-bar')).not.toBeNull() })
    publishUpdateState(bar, { phase: 'available', version: '0.1.7' })
    expect(updateBadge().getAttribute('data-visible')).toBe('')
    expect(updateBadge().getAttribute('data-phase')).toBe('available')
    expect(updateBadge().textContent).toContain('0.1.7')
    expect(updateBadge().disabled).toBe(false)
    updateBadge().click()
    expect(bar.updates.install).toHaveBeenCalledOnce()
  })

  it('reports download progress in place', async () => {
    const bar = transport()
    installDesktopTitleBar(bar)
    await vi.waitFor(() => { expect(document.querySelector('.dsh-desktop-title-bar')).not.toBeNull() })
    publishUpdateState(bar, {
      phase: 'downloading',
      version: '0.1.7',
      progress: { percent: 42, transferred: 10, total: 24, bytesPerSecond: 1 },
    })
    const badge = updateBadge()
    expect(badge.getAttribute('data-phase')).toBe('downloading')
    expect(badge.textContent).toContain('42')
    expect(badge.querySelector<HTMLElement>('.dsh-desktop-title-bar-update-bar')?.style.width).toBe('42%')
    badge.click()
    expect(bar.updates.install).not.toHaveBeenCalled()
  })

  it('shows a check in flight and a requested check that failed', async () => {
    const bar = transport()
    installDesktopTitleBar(bar)
    await vi.waitFor(() => { expect(document.querySelector('.dsh-desktop-title-bar')).not.toBeNull() })
    publishUpdateState(bar, { phase: 'checking' })
    expect(updateBadge().getAttribute('data-phase')).toBe('checking')
    expect(updateBadge().textContent).toBe(LOCALE.messages.updateBadgeChecking)
    publishUpdateState(bar, { phase: 'error', message: 'offline' })
    expect(updateBadge().getAttribute('data-phase')).toBe('error')
    expect(updateBadge().disabled).toBe(false)
    updateBadge().click()
    expect(bar.updates.check).toHaveBeenCalledOnce()
  })

  it('renders the state a window discovers after it opened', async () => {
    const bar = transport()
    bar.updates.status.mockResolvedValueOnce({ phase: 'available', version: '9.9.9' })
    installDesktopTitleBar(bar)
    await vi.waitFor(() => { expect(updateBadge().getAttribute('data-phase')).toBe('available') })
    expect(updateBadge().textContent).toContain('9.9.9')
  })
})
