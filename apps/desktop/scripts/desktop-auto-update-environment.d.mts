/** Environment variable that selects the Desktop update deployment. */
export const DESKTOP_AUTO_UPDATE_ENV: 'DSH_DESKTOP_AUTO_UPDATE_ENV'

/** Environment variable naming the repository that hosts the github deployment's releases. */
export const DESKTOP_UPDATE_REPOSITORY: 'DSH_DESKTOP_UPDATE_REPOSITORY'

/** Supported Desktop update deployment. */
export type DesktopAutoUpdateEnvironment = 'test' | 'production' | 'github'

/** Directory name of one supported Desktop release target. */
export type DesktopAutoUpdateTarget = 'mac-arm64' | 'mac-x64' | 'win-x64'

/** electron-builder publish descriptor for one resolved update channel. */
export type DesktopUpdatePublish =
  | { readonly provider: 'generic', readonly url: string }
  | { readonly provider: 'github', readonly owner: string, readonly repo: string }

/** Updater channel resolved for one release target. */
export interface DesktopUpdateConfig {
  readonly environment: DesktopAutoUpdateEnvironment
  readonly target: DesktopAutoUpdateTarget
  readonly publish: DesktopUpdatePublish
  readonly publicUrl: string
}

/** Object-hosted updater channel with its versioned key prefix. */
export interface DesktopAutoUpdateConfig extends DesktopUpdateConfig {
  readonly environment: 'test' | 'production'
  readonly origin: string
  readonly keyPrefix: string
}

/** Public updater URL and private COS destination for one upload target. */
export interface DesktopUploadConfig extends DesktopAutoUpdateConfig {
  readonly bucket: string
  readonly secretIdEnvName: string
  readonly secretKeyEnvName: string
}

/**
 * Resolve the update deployment, defaulting local release work to test.
 * @param env - Packaging or upload environment.
 * @returns Validated deployment name.
 */
export function resolveDesktopAutoUpdateEnvironment(
  env: NodeJS.ProcessEnv,
): DesktopAutoUpdateEnvironment

/**
 * Report whether a packaging environment publishes through repository releases.
 * @param env - Packaging environment.
 * @returns True when the github deployment is selected.
 */
export function desktopUsesRepositoryUpdates(env: NodeJS.ProcessEnv): boolean

/**
 * Resolve one supported platform and architecture to its update directory.
 * @param platform - Target Node.js platform.
 * @param arch - Target Node.js architecture.
 * @returns Update target directory.
 */
export function resolveDesktopAutoUpdateTarget(
  platform: NodeJS.Platform,
  arch: string,
): DesktopAutoUpdateTarget

/**
 * Return the local completion record filename for one packaged target.
 * @param target - Supported release target.
 * @returns Filename stored beside electron-builder artifacts.
 */
export function desktopBuildRecordFilename(target: DesktopAutoUpdateTarget): string

/**
 * Return the electron-builder channel metadata filename for an application version.
 * @param version - Desktop semantic version.
 * @param platform - Target platform.
 * @returns Channel metadata filename emitted for the target.
 */
export function desktopUpdateMetadataFilename(
  version: string,
  platform: NodeJS.Platform,
): string

/**
 * Resolve the updater channel for one release target.
 * @param env - Packaging or upload environment.
 * @param platform - Target Node.js platform.
 * @param arch - Target Node.js architecture.
 * @returns Resolved updater configuration.
 * @throws When the selected deployment lacks a valid origin or repository.
 */
export function resolveDesktopAutoUpdateConfig(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  arch: string,
): DesktopUpdateConfig

/**
 * Resolve the public updater URL and private COS destination for one upload target.
 * @param env - Upload environment.
 * @param platform - Target Node.js platform.
 * @param arch - Target Node.js architecture.
 * @returns Resolved upload configuration.
 * @throws When the github deployment is selected, or the selected deployment lacks a required origin or bucket.
 */
export function resolveDesktopUploadConfig(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  arch: string,
): DesktopUploadConfig
