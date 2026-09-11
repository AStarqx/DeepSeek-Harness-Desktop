import { afterEach, expect, it, vi } from 'vitest'
import { DESKTOP_IPC } from '../src/ipc.ts'
import type { DesktopTitleBarTransport } from '../src/titlebar.ts'

const electron = vi.hoisted(() => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), off: vi.fn() },
}))
vi.mock('electron', () => electron)

const titlebar = vi.hoisted(() => ({ installDesktopTitleBar: vi.fn() }))
vi.mock('../src/titlebar.ts', () => titlebar)

afterEach(() => { vi.clearAllMocks(); vi.resetModules() })

it('exposes the plugin operations and installs the shell title bar', async () => {
  await import('../src/preload.ts')
  const api = electron.contextBridge.exposeInMainWorld.mock.calls[0]?.[1] as {
    readonly protocolVersion: number
    readonly plugins: { list(): Promise<unknown> }
  }
  expect(electron.contextBridge.exposeInMainWorld).toHaveBeenCalledWith('dshDesktop', api)
  expect(api.protocolVersion).toBe(1)
  await api.plugins.list()
  const transport = titlebar.installDesktopTitleBar.mock.calls[0]?.[0] as DesktopTitleBarTransport | undefined
  if (transport === undefined) throw new Error('the preload did not install a title bar')
  await transport.locale()
  await transport.openMenu({ x: 1, y: 36 })
  await transport.reportSymbolColor('rgb(0, 0, 0)')
  expect(electron.ipcRenderer.invoke.mock.calls).toEqual([
    [DESKTOP_IPC.pluginsList],
    [DESKTOP_IPC.localeGet],
    [DESKTOP_IPC.applicationMenuOpen, { x: 1, y: 36 }],
    [DESKTOP_IPC.titleBarSymbolColor, 'rgb(0, 0, 0)'],
  ])
})
