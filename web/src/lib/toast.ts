import { toast as sonner } from 'vue-sonner'
import { isOffline } from '@/lib/connectivity'
import { getNetworkErrorKind, isQuietNetworkError } from '@/lib/network-errors'

/**
 * The app's toast entry point. Import `toast` from here, never from
 * `vue-sonner` directly — this wrapper is where "don't shout at someone
 * who is offline" is enforced.
 *
 * Being offline is a state, and the app already says so plainly: the sync
 * chip in the sidebar, and an offline empty state on whatever view couldn't
 * load. A red toast on top of that is noise the user can do nothing about —
 * and because nearly every service catches its own fetch failure and toasts
 * a message of its own ("Failed to fetch collections"), suppressing this at
 * the axios interceptor alone never worked.
 *
 * So `toast.error` is dropped while offline. Two escape hatches:
 *   - `force: true` for an error the user must see even offline (a
 *     destructive local action that genuinely failed).
 *   - `cause: error` to suppress on the error's own merits (a cancelled or
 *     offline request) regardless of the current connectivity state, for
 *     the race where connectivity returns before the catch block runs.
 *
 * Success/info/warning toasts pass through untouched: an optimistic
 * "Saved" while offline is true and worth showing.
 */

export interface ErrorToastOptions extends Record<string, unknown> {
  /** Show even while offline. */
  force?: boolean
  /** The error being reported, so quiet kinds are dropped on their merits. */
  cause?: unknown
}

function suppressed(options?: ErrorToastOptions): boolean {
  if (options?.force) return false
  if (
    options?.cause !== undefined &&
    isQuietNetworkError(getNetworkErrorKind(options.cause))
  ) {
    return true
  }
  return isOffline.value
}

type Sonner = typeof sonner
type ErrorArgs = Parameters<Sonner['error']>

/**
 * Our `error` signature is listed first so it wins overload resolution and
 * `force` / `cause` are accepted; everything else is sonner's own API.
 */
type AppToast = {
  error(
    message: ErrorArgs[0],
    options?: ErrorArgs[1] & ErrorToastOptions,
  ): ReturnType<Sonner['error']>
} & Sonner

const wrapped = ((...args: Parameters<Sonner>) =>
  sonner(...args)) as unknown as Sonner

Object.assign(wrapped, sonner)

wrapped.error = ((message: ErrorArgs[0], options?: ErrorToastOptions) => {
  if (suppressed(options)) return
  const { force: _force, cause: _cause, ...rest } = options ?? {}
  return (sonner.error as any)(message, rest)
}) as Sonner['error']

export const toast = wrapped as AppToast
