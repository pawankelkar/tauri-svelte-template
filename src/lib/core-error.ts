import type { CoreError, ProFeature } from '$lib/tauri-bindings'
import { t } from '$lib/i18n/t.svelte'

const CORE_ERROR_KINDS: ReadonlySet<CoreError['kind']> = new Set([
  'featureDisabled',
  'notEntitled',
  'offline',
  'hostNotAllowed',
  'network',
  'invalidInput',
  'notFound',
  'conflict',
  'noVault',
  'pathOutsideVault',
  'alreadyExists',
  'internal',
])

/** Whether a rejected value is a `CoreError` from a Rust command. */
export function isCoreError(value: unknown): value is CoreError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    CORE_ERROR_KINDS.has((value as { kind: CoreError['kind'] }).kind)
  )
}

/** A `CoreError` narrowed to one `kind`. */
export type CoreErrorOf<K extends CoreError['kind']> = Extract<
  CoreError,
  { kind: K }
>

/**
 * Whether a rejected value is a `CoreError` of the given kind, e.g.
 * `isCoreErrorKind(err, 'conflict')` to offer a reload after a stale write.
 */
export function isCoreErrorKind<K extends CoreError['kind']>(
  value: unknown,
  kind: K,
): value is CoreErrorOf<K> {
  return isCoreError(value) && value.kind === kind
}

/** The display name of a Pro feature. */
export function proFeatureLabel(feature: ProFeature): string {
  return t(`pro.feature.${feature}.label`)
}

/** A user-facing, translated sentence describing a `CoreError`. */
export function describeCoreError(e: CoreError): string {
  switch (e.kind) {
    case 'featureDisabled':
      return t('errors.core.featureDisabled', {
        feature: e.feature,
        reason: e.reason,
      })
    case 'notEntitled':
      return t('errors.core.notEntitled', {
        feature: proFeatureLabel(e.feature),
      })
    case 'offline':
      return t('errors.core.offline', { host: e.host })
    case 'hostNotAllowed':
      return t('errors.core.hostNotAllowed', { host: e.host })
    case 'network':
      return t('errors.core.network', { message: e.message })
    case 'invalidInput':
      return t('errors.core.invalidInput', { message: e.message })
    case 'notFound':
      return t('errors.core.notFound', { what: e.what })
    case 'conflict':
      return t('errors.core.conflict', { path: e.path })
    case 'noVault':
      return t('errors.core.noVault')
    case 'pathOutsideVault':
      return t('errors.core.pathOutsideVault', { path: e.path })
    case 'alreadyExists':
      return t('errors.core.alreadyExists', { path: e.path })
    case 'internal':
      return t('errors.core.internal', { message: e.message })
  }
}

/**
 * Describes anything a command can reject with: a `CoreError`, an `Error`
 * thrown by the IPC layer itself, or a bare string from an older command.
 */
export function describeError(e: unknown): string {
  if (isCoreError(e)) return describeCoreError(e)
  if (e instanceof Error && e.message) return e.message
  if (typeof e === 'string' && e) return e
  return t('errors.unknown')
}
