/** Resolve the Desktop auto-update channel and its publication destination. */

import { prerelease, valid } from 'semver'

/** Environment variable that selects the Desktop update deployment. */
export const DESKTOP_AUTO_UPDATE_ENV = 'DSH_DESKTOP_AUTO_UPDATE_ENV'

/**
 * Environment variable naming the `owner/name` repository that hosts the `github` deployment's
 * releases.
 */
export const DESKTOP_UPDATE_REPOSITORY = 'DSH_DESKTOP_UPDATE_REPOSITORY'

const UPDATE_ENVIRONMENTS = {
  test: {
    originEnvName: 'DOWNLOAD_TEST_ORIGIN',
    fixedOrigin: undefined,
    bucketEnvName: 'DOWNLOAD_TEST_COS_BUCKET',
    secretIdEnvName: 'DOWNLOAD_TEST_COS_SECRET_ID',
    secretKeyEnvName: 'DOWNLOAD_TEST_COS_SECRET_KEY',
  },
  production: {
    originEnvName: undefined,
    fixedOrigin: 'https://download.deepseek.com',
    bucketEnvName: 'DOWNLOAD_PROD_COS_BUCKET',
    secretIdEnvName: 'DOWNLOAD_PROD_COS_SECRET_ID',
    secretKeyEnvName: 'DOWNLOAD_PROD_COS_SECRET_KEY',
  },
}

const UPDATE_TARGETS = new Set(['mac-arm64', 'mac-x64', 'win-x64'])

/**
 * Resolve the update deployment, defaulting local release work to test.
 * @param {NodeJS.ProcessEnv} env - Packaging or upload environment.
 * @returns {'test' | 'production' | 'github'} Validated deployment name.
 */
export function resolveDesktopAutoUpdateEnvironment(env) {
  const value = env[DESKTOP_AUTO_UPDATE_ENV]?.trim() || 'test'
  if (value !== 'test' && value !== 'production' && value !== 'github') {
    throw new Error(`desktop auto-update: ${DESKTOP_AUTO_UPDATE_ENV} must be "test", "production", or "github"`)
  }
  return value
}

/**
 * Report whether a packaging environment publishes through repository releases.
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @returns {boolean} True when the github deployment is selected.
 */
export function desktopUsesRepositoryUpdates(env) {
  return resolveDesktopAutoUpdateEnvironment(env) === 'github'
}

/**
 * Split one `owner/name` repository setting.
 * @param {string} value - Repository setting.
 * @returns {{ owner: string, name: string }} Validated repository parts.
 */
function repositoryParts(value) {
  const match = /^([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/([A-Za-z0-9._-]+)$/.exec(value)
  if (match === null) {
    throw new Error(`desktop auto-update: ${DESKTOP_UPDATE_REPOSITORY} must name an owner/name GitHub repository`)
  }
  return { owner: match[1], name: match[2] }
}

/**
 * Resolve one supported platform and architecture to its update directory.
 * @param {NodeJS.Platform} platform - Target Node.js platform.
 * @param {string} arch - Target Node.js architecture.
 * @returns {'mac-arm64' | 'mac-x64' | 'win-x64'} Update target directory.
 */
export function resolveDesktopAutoUpdateTarget(platform, arch) {
  const os = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : platform
  const target = `${os}-${arch}`
  if (!UPDATE_TARGETS.has(target)) {
    throw new Error(`desktop auto-update: unsupported target ${target}`)
  }
  return target
}

/**
 * Return the local completion record filename for one packaged target.
 * @param {'mac-arm64' | 'mac-x64' | 'win-x64'} target - Supported release target.
 * @returns {string} Filename stored beside electron-builder artifacts.
 */
export function desktopBuildRecordFilename(target) {
  if (!UPDATE_TARGETS.has(target)) {
    throw new Error(`desktop auto-update: unsupported target ${target}`)
  }
  return `${target}-release.json`
}

/**
 * Return the electron-builder channel metadata filename for an application version.
 * @param {string} version - Desktop semantic version.
 * @param {NodeJS.Platform} platform - Target platform.
 * @returns {string} Channel metadata filename emitted for the target.
 */
export function desktopUpdateMetadataFilename(version, platform) {
  if (valid(version) === null) {
    throw new Error(`desktop auto-update: invalid Desktop version ${JSON.stringify(version)}`)
  }
  if (platform !== 'darwin' && platform !== 'win32') {
    throw new Error(`desktop auto-update: unsupported metadata platform ${platform}`)
  }
  const release = prerelease(version)
  const channel = release === null ? 'latest' : String(release[0])
  return `${channel}${platform === 'darwin' ? '-mac' : ''}.yml`
}

/**
 * Read one required release setting without accepting whitespace-only values.
 * @param {NodeJS.ProcessEnv} env - Packaging or upload environment.
 * @param {string} name - Environment variable to read.
 * @returns {string} Trimmed setting.
 */
function requiredEnvironmentValue(env, name) {
  const value = env[name]?.trim()
  if (value === undefined || value === '') {
    throw new Error(`desktop auto-update: ${name} must be set to a non-empty value`)
  }
  return value
}

/**
 * Normalize an HTTPS origin and reject paths or credentials.
 * @param {string} value - Candidate origin.
 * @param {string} name - Environment variable used in diagnostics.
 * @returns {string} Normalized HTTPS origin without a trailing slash.
 */
function httpsOrigin(value, name) {
  let parsed
  try {
    parsed = new URL(value)
  }
  catch {
    throw new Error(`desktop auto-update: ${name} must be an absolute HTTPS origin`)
  }
  if (parsed.protocol !== 'https:'
    || parsed.username !== ''
    || parsed.password !== ''
    || parsed.pathname !== '/'
    || parsed.search !== ''
    || parsed.hash !== '') {
    throw new Error(`desktop auto-update: ${name} must be an absolute HTTPS origin without a path, credentials, query, or fragment`)
  }
  return parsed.origin
}

/**
 * Resolve the updater channel for one release target.
 * @param {NodeJS.ProcessEnv} env - Packaging or upload environment.
 * @param {NodeJS.Platform} platform - Target Node.js platform.
 * @param {string} arch - Target Node.js architecture.
 * @returns {{ environment: 'test' | 'production' | 'github', target: 'mac-arm64' | 'mac-x64' | 'win-x64', publish: { provider: 'generic', url: string } | { provider: 'github', owner: string, repo: string }, publicUrl: string, origin?: string, keyPrefix?: string }} Resolved updater configuration.
 * @throws {Error} When the selected deployment lacks a valid origin or repository.
 */
export function resolveDesktopAutoUpdateConfig(env, platform, arch) {
  const environment = resolveDesktopAutoUpdateEnvironment(env)
  const target = resolveDesktopAutoUpdateTarget(platform, arch)
  if (environment === 'github') {
    const repository = repositoryParts(requiredEnvironmentValue(env, DESKTOP_UPDATE_REPOSITORY))
    return {
      environment,
      target,
      publish: { provider: 'github', owner: repository.owner, repo: repository.name },
      publicUrl: `https://github.com/${repository.owner}/${repository.name}/releases/latest/download/`,
    }
  }
  const deployment = UPDATE_ENVIRONMENTS[environment]
  let origin = deployment.fixedOrigin
  if (origin === undefined) {
    const { originEnvName } = deployment
    if (originEnvName === undefined) throw new Error('desktop auto-update: selected deployment has no origin')
    origin = httpsOrigin(requiredEnvironmentValue(env, originEnvName), originEnvName)
  }
  const keyPrefix = `_/harness/desktop/stable/${target}`
  const publicUrl = `${origin}/${keyPrefix}/`
  return {
    environment,
    target,
    origin,
    keyPrefix,
    publicUrl,
    publish: { provider: 'generic', url: publicUrl },
  }
}

/**
 * Resolve the public updater URL and private COS destination for one upload target.
 * @param {NodeJS.ProcessEnv} env - Upload environment.
 * @param {NodeJS.Platform} platform - Target Node.js platform.
 * @param {string} arch - Target Node.js architecture.
 * @returns {{ environment: 'test' | 'production', target: 'mac-arm64' | 'mac-x64' | 'win-x64', origin: string, publicUrl: string, keyPrefix: string, publish: { provider: 'generic', url: string }, bucket: string, secretIdEnvName: string, secretKeyEnvName: string }} Resolved upload configuration.
 * @throws {Error} When the github deployment is selected, when the selected deployment lacks a required origin or bucket, or when the test origin is not HTTPS.
 */
export function resolveDesktopUploadConfig(env, platform, arch) {
  const update = resolveDesktopAutoUpdateConfig(env, platform, arch)
  if (update.environment === 'github') {
    throw new Error('desktop auto-update: the github deployment publishes through its repository releases, not the COS upload command')
  }
  const deployment = UPDATE_ENVIRONMENTS[update.environment]
  return {
    ...update,
    bucket: requiredEnvironmentValue(env, deployment.bucketEnvName),
    secretIdEnvName: deployment.secretIdEnvName,
    secretKeyEnvName: deployment.secretKeyEnvName,
  }
}
