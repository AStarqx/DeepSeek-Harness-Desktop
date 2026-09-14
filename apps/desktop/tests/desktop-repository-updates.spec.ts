import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const RELEASE_ENVIRONMENT = {
  DSH_DESKTOP_APP_ID: 'com.astarqx.deepseek-harness-desktop',
  DSH_DESKTOP_TARGET_PLATFORM: 'win32',
  DSH_DESKTOP_TARGET_ARCH: 'x64',
  DSH_DESKTOP_UNSIGNED: '1',
  DOWNLOAD_TEST_ORIGIN: 'https://desktop-updates.example.com',
}

// Importing the electron-builder configuration loads app-builder-lib, which is slow beside a full suite.
describe('desktop repository release channel', { timeout: 60_000 }, () => {
  beforeAll(() => {
    for (const [name, value] of Object.entries(RELEASE_ENVIRONMENT)) vi.stubEnv(name, value)
  })

  afterAll(() => {
    vi.unstubAllEnvs()
  })

  it('keeps updater configuration in an unsigned Windows package', async () => {
    const { createElectronBuilderConfig } = await import('../electron-builder.config.mjs')
    const config = createElectronBuilderConfig({
      ...RELEASE_ENVIRONMENT,
      DSH_DESKTOP_AUTO_UPDATE_ENV: 'github',
      DSH_DESKTOP_UPDATE_REPOSITORY: 'AStarqx/DeepSeek-Harness-Desktop',
    }, 'win32', 'x64')
    expect(config.publish).toEqual([{
      provider: 'github',
      owner: 'AStarqx',
      repo: 'DeepSeek-Harness-Desktop',
    }])
  })

  it('leaves an unsigned Windows package without updater configuration by default', async () => {
    const { createElectronBuilderConfig } = await import('../electron-builder.config.mjs')
    expect(createElectronBuilderConfig(RELEASE_ENVIRONMENT, 'win32', 'x64').publish).toBeNull()
  })

  it('requires the repository before packaging an unsigned repository release', async () => {
    const { createElectronBuilderConfig } = await import('../electron-builder.config.mjs')
    expect(() => createElectronBuilderConfig({
      ...RELEASE_ENVIRONMENT,
      DSH_DESKTOP_AUTO_UPDATE_ENV: 'github',
    }, 'win32', 'x64')).toThrow(/DSH_DESKTOP_UPDATE_REPOSITORY/u)
  })
})
