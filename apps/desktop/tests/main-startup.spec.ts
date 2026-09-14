import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { DESKTOP_IPC, type DesktopUpdateState } from '../src/ipc.ts'

const harness = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  function deferred() {
    let resolve!: () => void
    let reject!: (error: Error) => void
    const promise = new Promise<void>((accept, decline) => { resolve = accept; reject = decline })
    return { promise, resolve, reject }
  }
  const windows: FakeWindow[] = []
  const hosts: FakeHost[] = []
  const handlers = new Map<string, (event: { senderFrame: { url: string } }, payload?: unknown) => unknown>()
  const menuPopup = vi.fn()
  const menuTemplates: unknown[][] = []
  let pluginsEnabled = false
  let preparing = deferred()
  let prepared = deferred()
  let hostStarted = deferred()
  let navigated = deferred()
  let errorPublished = deferred()
  let quitCompleted = deferred()
  class FakeWindow extends EventEmitter {
    destroyed = false
    readonly urls: string[] = []
    readonly webContents = Object.assign(new EventEmitter(), {
      setWindowOpenHandler: vi.fn(),
      openDevTools: vi.fn(),
      getURL: () => this.urls.at(-1) ?? '',
      send: vi.fn((channel: string, state: { phase?: string }) => {
        if (channel === 'dsh-desktop:backend-state' && state.phase === 'error') errorPublished.resolve()
      }),
    })
    readonly show = vi.fn()
    readonly focus = vi.fn()
    readonly restore = vi.fn()
    readonly setTitleBarOverlay = vi.fn()
    constructor(readonly options: {
      show: boolean
      icon?: string
      titleBarStyle?: string
      titleBarOverlay?: { color: string; symbolColor: string; height: number }
    }) { super(); windows.push(this) }
    isDestroyed() { return this.destroyed }
    isMinimized() { return false }
    async loadURL(url: string) {
      this.urls.push(url)
      if (url === 'dsh-app://app/index.html') navigated.resolve()
    }
    static getAllWindows() { return windows.filter(window => !window.destroyed) }
    static fromWebContents() { return windows.find(window => !window.destroyed) ?? null }
    static getFocusedWindow() { return windows.find(window => !window.destroyed) ?? null }
    close() { this.destroyed = true; this.emit('closed') }
  }
  class FakeHost {
    readonly ready = deferred()
    readonly exited = deferred()
    readonly stopping = deferred()
    readonly start = vi.fn(() => { hostStarted.resolve(); return this.ready.promise })
    readonly stop = vi.fn(() => {
      this.stopping.resolve()
      this.ready.reject(new Error('child stopped'))
      return this.exited.promise
    })
    constructor(readonly node: string, readonly runtime: string, readonly profile: string) { hosts.push(this) }
  }
  class FakeUpdateCoordinator {
    static readonly instances: FakeUpdateCoordinator[] = []
    state: DesktopUpdateState = { phase: 'idle' }
    readonly check = vi.fn(async () => this.publish(this.state))
    readonly install = vi.fn(async () => this.publish({ phase: 'ready', version: '9.9.9' }))
    constructor(
      readonly publish: (state: DesktopUpdateState) => DesktopUpdateState,
      readonly beforeRestart?: () => Promise<void>,
    ) { FakeUpdateCoordinator.instances.push(this) }
  }
  const app = Object.assign(new EventEmitter(), {
    isPackaged: true,
    name: 'Desktop test',
    whenReady: () => Promise.resolve(),
    getLocale: () => 'en-US',
    getVersion: () => '1.0.0',
    getAppPath: () => 'desktop-test-app',
    requestSingleInstanceLock: () => true,
    exit: vi.fn(),
    relaunch: vi.fn(),
    quit: vi.fn(() => {
      const event = { preventDefault: vi.fn() }
      app.emit('before-quit', event)
      if (event.preventDefault.mock.calls.length === 0) quitCompleted.resolve()
    }),
  })
  return {
    windows, hosts, handlers, app, FakeWindow, FakeHost, FakeUpdateCoordinator, menuPopup, menuTemplates,
    dialog: { showErrorBox: vi.fn(), showMessageBox: vi.fn() },
    shell: { openExternal: vi.fn(() => Promise.resolve()) },
    applyRelease: vi.fn(() => { preparing.resolve(); return prepared.promise }),
    assertProfileRuntime: vi.fn(),
    canRecoverProfile: vi.fn(() => true),
    get preparing() { return preparing }, get prepared() { return prepared },
    get hostStarted() { return hostStarted }, get navigated() { return navigated },
    get errorPublished() { return errorPublished }, get quitCompleted() { return quitCompleted },
    nextHostStart() { hostStarted = deferred(); return hostStarted.promise },
    get pluginsEnabled() { return pluginsEnabled },
    set pluginsEnabled(value: boolean) { pluginsEnabled = value },
    reset() {
      windows.length = 0; hosts.length = 0; handlers.clear(); app.removeAllListeners()
      menuTemplates.length = 0
      FakeUpdateCoordinator.instances.length = 0
      app.isPackaged = true
      pluginsEnabled = false
      preparing = deferred(); prepared = deferred(); hostStarted = deferred()
      navigated = deferred(); errorPublished = deferred(); quitCompleted = deferred()
    },
  }
})

vi.mock('electron', () => ({
  app: harness.app,
  BrowserWindow: harness.FakeWindow,
  dialog: harness.dialog,
  ipcMain: {
    handle: (channel: string, handler: (event: { senderFrame: { url: string } }, payload?: unknown) => unknown) => {
      harness.handlers.set(channel, handler)
    },
  },
  Menu: {
    setApplicationMenu: vi.fn(),
    buildFromTemplate: vi.fn((template: unknown[]) => {
      harness.menuTemplates.push(template)
      return { popup: harness.menuPopup }
    }),
  },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
  shell: harness.shell,
}))
vi.mock('../src/paths.ts', () => ({ resolveDesktopPaths: () => ({ profile: 'desktop-test-profile' }) }))
vi.mock('../src/project-manager.ts', () => ({
  DesktopProjectManager: class {
    readonly applyRelease = harness.applyRelease
    readonly assertProfileRuntime = harness.assertProfileRuntime
    canRecoverProfile = harness.canRecoverProfile
    async mutate(_mutation: unknown, hooks: { beforeChange(): Promise<void>; afterChange(): Promise<void> }) {
      await hooks.beforeChange()
      harness.pluginsEnabled = false
      await hooks.afterChange()
    }
    async resetConfiguration(hooks: { beforeChange(): Promise<void>; afterChange(): Promise<void> }) {
      await this.mutate(undefined, hooks)
    }
  },
}))
vi.mock('../src/host-process.ts', () => ({ DesktopHostProcess: harness.FakeHost }))
vi.mock('../src/update-coordinator.ts', () => ({ DesktopUpdateCoordinator: harness.FakeUpdateCoordinator }))

function invoke(channel: string): unknown {
  return invokeFrom('dsh-app://shell/startup.html', channel)
}

function invokeFrom(url: string, channel: string, payload?: unknown): unknown {
  const handler = harness.handlers.get(channel)
  if (handler === undefined) throw new Error(`missing handler ${channel}`)
  return handler({ senderFrame: { url } }, payload)
}

/** Find one application-menu item by its localized label, descending into the macOS wrapper menu. */
function menuItem(label: string): { click?: () => void } {
  const search = (items: unknown[]): { click?: () => void } | undefined => {
    for (const entry of items as Array<{ label?: string; submenu?: unknown[]; click?: () => void }>) {
      if (entry.label === label && entry.click !== undefined) return entry
      if (Array.isArray(entry.submenu)) {
        const found = search(entry.submenu)
        if (found !== undefined) return found
      }
    }
    return undefined
  }
  for (const template of harness.menuTemplates) {
    const found = search(template)
    if (found !== undefined) return found
  }
  throw new Error(`the application menu has no item labeled ${label}`)
}

/** Read the options of the most recent message box, with or without an owner window. */
function lastMessageBoxOptions(): Record<string, unknown> {
  const call = harness.dialog.showMessageBox.mock.calls.at(-1)
  if (call === undefined) throw new Error('no message box was shown')
  return (call.length === 2 ? call[1] : call[0]) as Record<string, unknown>
}

/** The update coordinator the running application constructed. */
function updateCoordinator(): InstanceType<typeof harness.FakeUpdateCoordinator> {
  const coordinator = harness.FakeUpdateCoordinator.instances.at(-1)
  if (coordinator === undefined) throw new Error('the application did not construct an update coordinator')
  return coordinator
}

/** Start the application and wait until its window shows the backend and the update timers are armed. */
async function startApplication(): Promise<void> {
  await import('../src/main.ts')
  await harness.preparing.promise
  harness.prepared.resolve()
  await harness.hostStarted.promise
  harness.hosts[0]!.ready.resolve()
  await harness.navigated.promise
  await vi.waitFor(() => {
    const send = harness.windows[0]!.webContents.send
    expect(send).toHaveBeenCalledWith(DESKTOP_IPC.updatesState, { phase: 'idle' })
  })
}

/** States the shell pushed to the main window over the update channel. */
function publishedUpdateStates(): DesktopUpdateState[] {
  return harness.windows[0]!.webContents.send.mock.calls
    .filter(call => call[0] === DESKTOP_IPC.updatesState)
    .map(call => call[1] as DesktopUpdateState)
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.useFakeTimers()
  harness.reset()
  harness.dialog.showMessageBox.mockResolvedValue({ response: 1 })
  vi.stubEnv('DSH_DESKTOP_NODE_BINARY', 'test-node')
  vi.stubEnv('DSH_DESKTOP_PNPM_ENTRY', 'test-pnpm')
  vi.stubEnv('DSH_DESKTOP_DSH_DIR', 'test-runtime')
  vi.stubGlobal('process', { ...process, resourcesPath: 'desktop-test-resources' })
  vi.stubEnv('DSH_DESKTOP_HOST_INSPECT_PORT', undefined)
})

afterEach(async () => {
  harness.prepared.resolve()
  for (const host of harness.hosts) { host.ready.resolve(); host.exited.resolve() }
  harness.app.quit()
  await harness.quitCompleted.promise
  vi.restoreAllMocks()
  harness.canRecoverProfile.mockReturnValue(true)
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('desktop main startup', () => {
  it('exits with a diagnostic when both initialization and emergency navigation fail', async () => {
    const exited = Promise.withResolvers<undefined>()
    vi.spyOn(harness.app, 'getLocale').mockImplementationOnce(() => { throw new Error('locale unavailable') })
    vi.spyOn(harness.FakeWindow.prototype, 'loadURL').mockRejectedValueOnce(new Error('emergency navigation failed'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    harness.app.exit.mockImplementationOnce(() => { exited.resolve(undefined) })
    await import('../src/main.ts')
    await exited.promise
    expect(harness.app.exit).toHaveBeenCalledWith(1)
    expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ message: 'emergency navigation failed' }))
  })

  it('withholds profile recovery after application resources fail to load', async () => {
    harness.canRecoverProfile.mockReturnValue(false)
    await import('../src/main.ts')
    await harness.preparing.promise
    harness.prepared.reject(new Error('runtime resources missing'))
    await harness.errorPublished.promise
    expect(invoke(DESKTOP_IPC.backendStatus)).toMatchObject({ phase: 'error', profileRecovery: false })
    const window = harness.windows[0]!
    window.webContents.emit('preload-error', {}, 'preload-app.cjs', new Error('preload unavailable'))
    const html = decodeURIComponent(window.urls.at(-1)!)
    expect(html).toContain('dsh-recovery://restart')
    expect(html).not.toContain('dsh-recovery://reset')
    expect(html).not.toContain('dsh-recovery://plugins')
  })

  it('reloads a crashed startup renderer in the same window', async () => {
    await import('../src/main.ts')
    await harness.preparing.promise
    const window = harness.windows[0]!
    window.webContents.emit('render-process-gone', {}, { reason: 'crashed' })
    await harness.errorPublished.promise
    expect(window.urls).toEqual(['dsh-app://shell/startup.html', 'dsh-app://shell/startup.html'])
    expect(invoke(DESKTOP_IPC.backendStatus)).toMatchObject({ phase: 'error', message: 'Desktop renderer exited: crashed' })
  })

  it.each(['plugins', 'reset'])('runs %s recovery from a document with a broken preload', async (action) => {
    await import('../src/main.ts')
    await harness.preparing.promise
    const window = harness.windows[0]!
    window.webContents.emit('preload-error', {}, 'preload-app.cjs', new Error('preload unavailable'))
    harness.prepared.resolve()
    await harness.hostStarted.promise
    harness.hosts[0]!.ready.resolve()
    await Promise.resolve(invoke(DESKTOP_IPC.backendRetry))
    const started = harness.nextHostStart()
    const event = { preventDefault: vi.fn() }
    window.webContents.emit('will-navigate', event, `dsh-recovery://${action}/?`)
    await harness.hosts[0]!.stopping.promise
    harness.hosts[0]!.exited.resolve()
    await started
    harness.hosts[1]!.ready.resolve()
    await harness.navigated.promise
    expect(event.preventDefault).toHaveBeenCalled()
    expect(window.urls.at(-1)).toBe('dsh-app://app/index.html')
  })

  it('allows a full profile reset for an unclassified startup failure', async () => {
    await import('../src/main.ts')
    await harness.preparing.promise
    harness.prepared.resolve()
    await harness.hostStarted.promise
    harness.hosts[0]!.exited.resolve()
    harness.hosts[0]!.ready.reject(new Error('Unknown startup failure'))
    await harness.errorPublished.promise
    const started = harness.nextHostStart()
    const reset = Promise.resolve(invoke(DESKTOP_IPC.configurationReset))
    await started
    harness.hosts[1]!.ready.resolve()
    await reset
    expect(invoke(DESKTOP_IPC.backendStatus)).toEqual({ phase: 'ready' })
  })

  it('keeps a self-contained reinstall document in the main window after preload failure', async () => {
    await import('../src/main.ts')
    await harness.preparing.promise
    const window = harness.windows[0]!
    window.webContents.emit('preload-error', {}, 'preload-app.cjs', new Error('preload unavailable'))
    expect(window.urls.at(-1)).toContain('data:text/html')
    expect(decodeURIComponent(window.urls.at(-1)!)).toContain('preload unavailable')
    harness.prepared.resolve()
    await harness.hostStarted.promise
    harness.hosts[0]!.ready.resolve()
    await Promise.resolve(invoke(DESKTOP_IPC.backendRetry))
    expect(harness.windows).toHaveLength(1)
    expect(window.urls.at(-1)).toContain('data:text/html')
    expect(harness.dialog.showErrorBox).not.toHaveBeenCalled()
  })

  it('offers plugin recovery and disables plugins before restarting in the same window', async () => {
    harness.pluginsEnabled = true
    await import('../src/main.ts')
    await harness.preparing.promise
    harness.prepared.resolve()
    await harness.hostStarted.promise
    harness.hosts[0]!.exited.resolve()
    harness.hosts[0]!.ready.reject(new Error('Plugin initialization failed'))
    await harness.errorPublished.promise
    expect(invoke(DESKTOP_IPC.backendStatus)).toMatchObject({ phase: 'error', profileRecovery: true })
    const nextStarted = harness.nextHostStart()
    const recovery = Promise.resolve(invoke(DESKTOP_IPC.pluginsDisableAll))
    await nextStarted
    expect(harness.pluginsEnabled).toBe(false)
    harness.hosts[1]!.ready.resolve()
    await recovery
    expect(harness.windows).toHaveLength(1)
    expect(invoke(DESKTOP_IPC.backendStatus)).toEqual({ phase: 'ready' })
  })

  it('waits for Host exit before relaunching the application', async () => {
    await import('../src/main.ts')
    await harness.preparing.promise
    harness.prepared.resolve()
    await harness.hostStarted.promise
    harness.hosts[0]!.ready.resolve()
    await harness.navigated.promise
    const restart = Promise.resolve(invoke(DESKTOP_IPC.applicationRestart))
    await harness.hosts[0]!.stopping.promise
    expect(harness.app.relaunch).not.toHaveBeenCalled()
    harness.hosts[0]!.exited.resolve()
    await restart
    expect(harness.app.relaunch).toHaveBeenCalledOnce()
  })

  it('shows the loading window before profile preparation and starts one actual Host', async () => {
    await import('../src/main.ts')
    await harness.preparing.promise
    expect(harness.windows).toHaveLength(1)
    const window = harness.windows[0]!
    expect(window.options.show).toBe(true)
    expect(window.urls).toEqual(['dsh-app://shell/startup.html'])
    expect(harness.hosts).toHaveLength(0)
    const retry = invoke(DESKTOP_IPC.backendRetry)
    const secondRetry = invoke(DESKTOP_IPC.backendRetry)
    harness.prepared.resolve()
    await harness.hostStarted.promise
    expect(harness.hosts).toHaveLength(1)
    expect(window.urls).toEqual(['dsh-app://shell/startup.html'])
    harness.hosts[0]!.ready.resolve()
    await Promise.all([retry, secondRetry, harness.navigated.promise])
    expect(harness.applyRelease).toHaveBeenCalledTimes(1)
    expect(harness.assertProfileRuntime).toHaveBeenCalledWith('desktop-test-profile')
    expect(harness.hosts[0]).toMatchObject({
      node: join('desktop-test-resources', 'runtime', 'node', process.platform === 'win32' ? 'node.exe' : 'node'),
      runtime: join('desktop-test-resources', 'dsh'),
      profile: 'desktop-test-profile',
    })
    expect(harness.hosts[0]!.start).toHaveBeenCalledTimes(1)
    expect(harness.windows).toHaveLength(1)
    expect(window.urls).toEqual(['dsh-app://shell/startup.html', 'dsh-app://app/index.html'])
    expect(invoke(DESKTOP_IPC.backendStatus)).toEqual({ phase: 'ready' })
  })

  it('starts the unpackaged Host from the application development directory', async () => {
    harness.app.isPackaged = false
    await import('../src/main.ts')
    await harness.hostStarted.promise
    const project = join(harness.app.getAppPath(), '.desktop-build', 'development', 'project')
    expect(harness.hosts[0]).toMatchObject({ node: 'test-node', runtime: project, profile: project })
    expect(harness.applyRelease).not.toHaveBeenCalled()
    expect(harness.assertProfileRuntime).not.toHaveBeenCalled()
    harness.hosts[0]!.ready.resolve()
    await harness.navigated.promise
    expect(harness.dialog.showErrorBox).not.toHaveBeenCalled()
  })

  it('keeps startup errors and a successful retry in the same window', async () => {
    await import('../src/main.ts')
    await harness.preparing.promise
    harness.prepared.resolve()
    await harness.hostStarted.promise
    const first = harness.hosts[0]!
    const failedRetry = expect(Promise.resolve(invoke(DESKTOP_IPC.backendRetry))).rejects.toThrow('plugin composition failed')
    first.exited.resolve()
    first.ready.reject(new Error('plugin composition failed'))
    await harness.errorPublished.promise
    await failedRetry
    expect(invoke(DESKTOP_IPC.backendStatus)).toEqual({ phase: 'error', message: 'plugin composition failed', profileRecovery: true })
    expect(harness.windows[0]!.urls).toEqual(['dsh-app://shell/startup.html'])
    const nextStarted = harness.nextHostStart()
    const retry = Promise.resolve(invoke(DESKTOP_IPC.backendRetry))
    await nextStarted
    expect(harness.hosts).toHaveLength(2)
    harness.hosts[1]!.ready.resolve()
    await retry
    expect(harness.windows).toHaveLength(1)
    expect(harness.windows[0]!.urls.at(-1)).toBe('dsh-app://app/index.html')
    expect(harness.dialog.showErrorBox).not.toHaveBeenCalled()
  })

  it('waits for a pending child to exit on quit without late window navigation', async () => {
    await import('../src/main.ts')
    await harness.preparing.promise
    harness.prepared.resolve()
    await harness.hostStarted.promise
    const window = harness.windows[0]!
    const host = harness.hosts[0]!
    host.stop.mockImplementation(() => { host.stopping.resolve(); return host.exited.promise })
    window.close()
    harness.app.quit()
    await host.stopping.promise
    expect(harness.app.quit).toHaveBeenCalledTimes(1)
    host.ready.resolve()
    host.exited.resolve()
    await harness.quitCompleted.promise
    expect(host.stop).toHaveBeenCalledTimes(1)
    expect(window.urls).toEqual(['dsh-app://shell/startup.html'])
    expect(harness.windows).toHaveLength(1)
  })
})

describe('desktop window chrome', () => {
  it('carries the shell title bar wherever the system menu bar is absent', async () => {
    const {
      DESKTOP_TITLE_BAR_HEIGHT,
      DESKTOP_TITLE_BAR_OVERLAY_COLOR,
      DESKTOP_TITLE_BAR_SYMBOL_COLOR,
      desktopOwnsWindowChrome,
    } = await import('../src/titlebar.ts')
    await import('../src/main.ts')
    await harness.preparing.promise
    const options = harness.windows[0]!.options
    if (!desktopOwnsWindowChrome(process.platform)) {
      expect(options.titleBarStyle).toBeUndefined()
      expect(options.titleBarOverlay).toBeUndefined()
      return
    }
    expect(options.titleBarStyle).toBe('hidden')
    expect(options.titleBarOverlay).toEqual({
      color: DESKTOP_TITLE_BAR_OVERLAY_COLOR,
      symbolColor: DESKTOP_TITLE_BAR_SYMBOL_COLOR,
      height: DESKTOP_TITLE_BAR_HEIGHT,
    })
  })

  it('opens the application menu at the anchor the title bar reported', async () => {
    await import('../src/main.ts')
    await harness.preparing.promise
    const window = harness.windows[0]!
    invokeFrom('dsh-app://app/index.html', DESKTOP_IPC.applicationMenuOpen, { x: 10.6, y: 36.2 })
    expect(harness.menuPopup).toHaveBeenCalledWith({ window, x: 11, y: 36 })
  })

  it.each([[{ x: -1, y: 0 }], [{ x: 0 }], [undefined]])('rejects the anchor %j', async (anchor) => {
    await import('../src/main.ts')
    await harness.preparing.promise
    expect(() => invokeFrom('dsh-app://app/index.html', DESKTOP_IPC.applicationMenuOpen, anchor))
      .toThrow(/application menu anchor/)
    expect(harness.menuPopup).not.toHaveBeenCalled()
  })

  it.skipIf(process.platform === 'darwin')('applies the reported window-control color to its own window', async () => {
    const { DESKTOP_TITLE_BAR_OVERLAY_COLOR } = await import('../src/titlebar.ts')
    await import('../src/main.ts')
    await harness.preparing.promise
    const window = harness.windows[0]!
    invokeFrom('dsh-app://app/index.html', DESKTOP_IPC.titleBarSymbolColor, 'rgb(237, 237, 240)')
    expect(window.setTitleBarOverlay).toHaveBeenCalledWith({
      color: DESKTOP_TITLE_BAR_OVERLAY_COLOR,
      symbolColor: 'rgb(237, 237, 240)',
    })
  })

  it('rejects a window-control color that is not a rendered color', async () => {
    await import('../src/main.ts')
    await harness.preparing.promise
    expect(() => invokeFrom('dsh-app://app/index.html', DESKTOP_IPC.titleBarSymbolColor, 'javascript:alert(1)'))
      .toThrow(/window-control color/)
    expect(harness.windows[0]!.setTitleBarOverlay).not.toHaveBeenCalled()
  })

  it('serves the title-bar locale to the loaded application document', async () => {
    await import('../src/main.ts')
    await harness.preparing.promise
    expect(invokeFrom('dsh-app://app/index.html', DESKTOP_IPC.localeGet)).toMatchObject({ id: 'en' })
    expect(() => invokeFrom('dsh-app://third-party/index.html', DESKTOP_IPC.localeGet)).toThrow(/unowned renderer/)
  })

  it('introduces the application and opens its project page from the About item', async () => {
    const { DESKTOP_PROJECT_URL, DESKTOP_UPSTREAM_URL } = await import('../src/about.ts')
    const { resolveDesktopLocale } = await import('../src/locale.ts')
    const messages = resolveDesktopLocale('en-US').messages
    await import('../src/main.ts')
    await harness.preparing.promise
    const about = menuItem(messages.aboutMenu)
    harness.dialog.showMessageBox.mockResolvedValueOnce({ response: 0 })
    about.click?.()
    await vi.waitFor(() => { expect(harness.shell.openExternal).toHaveBeenCalledWith(DESKTOP_PROJECT_URL) })
    expect(harness.dialog.showMessageBox).toHaveBeenCalledTimes(1)
    expect(lastMessageBoxOptions()).toMatchObject({
      title: messages.aboutTitle,
      message: `${messages.aboutTitle} ${harness.app.getVersion()}`,
      buttons: [messages.aboutOpenProject, messages.aboutClose],
      cancelId: 1,
    })
    const detail = String(lastMessageBoxOptions().detail)
    expect(detail).toContain(DESKTOP_PROJECT_URL)
    expect(detail).toContain(DESKTOP_UPSTREAM_URL)
  })

  it('closes the About dialog without opening a browser page', async () => {
    const { resolveDesktopLocale } = await import('../src/locale.ts')
    const messages = resolveDesktopLocale('en-US').messages
    await import('../src/main.ts')
    await harness.preparing.promise
    const about = menuItem(messages.aboutMenu)
    harness.dialog.showMessageBox.mockResolvedValueOnce({ response: 1 })
    about.click?.()
    await vi.waitFor(() => { expect(harness.dialog.showMessageBox).toHaveBeenCalledTimes(1) })
    await Promise.resolve()
    expect(harness.shell.openExternal).not.toHaveBeenCalled()
  })

  it('lights the update badge from an automatic check without interrupting the user', async () => {
    await startApplication()
    updateCoordinator().state = { phase: 'available', version: '0.1.7' }
    vi.advanceTimersByTime(10_000)
    await vi.waitFor(() => {
      expect(publishedUpdateStates()).toContainEqual({ phase: 'available', version: '0.1.7' })
    })
    expect(harness.dialog.showMessageBox).not.toHaveBeenCalled()
  })

  it('keeps a failed automatic check out of the badge', async () => {
    await startApplication()
    updateCoordinator().state = { phase: 'error', message: 'offline' }
    vi.advanceTimersByTime(10_000)
    await vi.waitFor(() => { expect(updateCoordinator().check).toHaveBeenCalled() })
    expect(publishedUpdateStates()).toContainEqual({ phase: 'idle' })
    expect(publishedUpdateStates()).not.toContainEqual({ phase: 'error', message: 'offline' })
  })

  it('reports a failed check the user asked for', async () => {
    const { resolveDesktopLocale } = await import('../src/locale.ts')
    const messages = resolveDesktopLocale('en-US').messages
    await import('../src/main.ts')
    await harness.preparing.promise
    updateCoordinator().state = { phase: 'error', message: 'offline' }
    menuItem(messages.checkUpdatesMenu).click?.()
    await vi.waitFor(() => { expect(harness.dialog.showMessageBox).toHaveBeenCalledTimes(1) })
    expect(lastMessageBoxOptions()).toMatchObject({ title: messages.updateCheckFailedTitle })
    expect(publishedUpdateStates()).toContainEqual({ phase: 'error', message: 'offline' })
  })

  it('downloads the release only when the user accepts the prompt', async () => {
    const { resolveDesktopLocale } = await import('../src/locale.ts')
    const messages = resolveDesktopLocale('en-US').messages
    await import('../src/main.ts')
    await harness.preparing.promise
    const coordinator = updateCoordinator()
    coordinator.state = { phase: 'available', version: '0.1.7' }
    harness.dialog.showMessageBox.mockResolvedValueOnce({ response: 1 })
    menuItem(messages.checkUpdatesMenu).click?.()
    await vi.waitFor(() => { expect(harness.dialog.showMessageBox).toHaveBeenCalledTimes(1) })
    expect(coordinator.install).not.toHaveBeenCalled()
    harness.dialog.showMessageBox.mockResolvedValueOnce({ response: 0 })
    menuItem(messages.checkUpdatesMenu).click?.()
    await vi.waitFor(() => { expect(coordinator.install).toHaveBeenCalledOnce() })
  })

  it('serves the current update state to a window that asks for it', async () => {
    await import('../src/main.ts')
    await harness.preparing.promise
    updateCoordinator().state = { phase: 'available', version: '0.1.7' }
    menuItem((await import('../src/locale.ts')).resolveDesktopLocale('en-US').messages.checkUpdatesMenu).click?.()
    await vi.waitFor(() => { expect(publishedUpdateStates()).toContainEqual({ phase: 'available', version: '0.1.7' }) })
    expect(invokeFrom('dsh-app://app/index.html', DESKTOP_IPC.updatesStatus))
      .toEqual({ phase: 'available', version: '0.1.7' })
  })
})
