/**
 * Network error classification.
 *
 * One failed request is not like another: being offline is normal and
 * expected, a connection-refused means the server (or the user's route to
 * it) is down, a timeout means it's slow, and a 4xx/5xx means it answered.
 * The API layer classifies every failure with `classifyNetworkError` and
 * decides from the kind whether to surface anything to the user; feature
 * code can read `getNetworkErrorKind(error)` to react (fall back to cache,
 * queue a write, stay quiet) without string-matching axios internals.
 */

import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'

export enum NetworkErrorKind {
  /** The device is offline — the request was suppressed or never left. */
  Offline = 'offline',
  /** Connection refused / DNS failure / server not answering at all. */
  Unreachable = 'unreachable',
  /** The server exists but didn't answer within the timeout. */
  Timeout = 'timeout',
  /** The server answered with a 4xx. */
  Client = 'client',
  /** The server answered with a 5xx. */
  Server = 'server',
  /** The caller aborted the request — never an error to show. */
  Cancelled = 'cancelled',
  /** Anything else (bug in request setup, unexpected browser failure). */
  Unknown = 'unknown',
}

/**
 * Thrown by the request interceptor when a read is suppressed because the
 * app is offline. Carries the config so callers can inspect what was
 * skipped. Classified as `Offline`, and never toasted.
 *
 * The message is deliberately plain English rather than a description of
 * the request: some catch blocks render `error.message` straight into the
 * UI, and "Request suppressed while offline: get /places/details" is not
 * something to say to a person. `method` and `url` carry the detail for
 * the console.
 */
export class OfflineRequestError extends Error {
  readonly kind = NetworkErrorKind.Offline
  readonly config: InternalAxiosRequestConfig
  readonly method?: string
  readonly url?: string

  constructor(config: InternalAxiosRequestConfig) {
    super("You're offline")
    this.name = 'OfflineRequestError'
    this.config = config
    this.method = config.method
    this.url = config.url
  }
}

const KIND_PROP = 'networkErrorKind'

/** Stamp the classification onto the error so it's classified only once. */
export function tagNetworkError(error: unknown, kind: NetworkErrorKind): void {
  if (error && typeof error === 'object') {
    ;(error as Record<string, unknown>)[KIND_PROP] = kind
  }
}

/**
 * Read a previously stamped classification, or classify on the fly.
 * Safe to call with anything a catch block might receive.
 */
export function getNetworkErrorKind(error: unknown): NetworkErrorKind {
  if (error && typeof error === 'object' && KIND_PROP in error) {
    return (error as Record<string, unknown>)[KIND_PROP] as NetworkErrorKind
  }
  return classifyNetworkError(error)
}

export function classifyNetworkError(
  error: unknown,
  opts: { navigatorOnline?: boolean } = {},
): NetworkErrorKind {
  if (error instanceof OfflineRequestError) return NetworkErrorKind.Offline
  if (axios.isCancel(error)) return NetworkErrorKind.Cancelled
  if (error instanceof DOMException && error.name === 'AbortError') {
    return NetworkErrorKind.Cancelled
  }

  if (axios.isAxiosError(error)) {
    const { response, request, code } = error as AxiosError

    if (response) {
      if (response.status >= 500) return NetworkErrorKind.Server
      if (response.status >= 400) return NetworkErrorKind.Client
      return NetworkErrorKind.Unknown
    }

    // Axios raises ECONNABORTED for its own timeout, ETIMEDOUT from the stack.
    if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
      return NetworkErrorKind.Timeout
    }

    if (request || code === 'ERR_NETWORK') {
      const online =
        opts.navigatorOnline ??
        (typeof navigator === 'undefined' ? true : navigator.onLine)
      return online ? NetworkErrorKind.Unreachable : NetworkErrorKind.Offline
    }
  }

  return NetworkErrorKind.Unknown
}

/** Kinds that mean "the network/server is the problem, retry later". */
export function isRetriableNetworkError(kind: NetworkErrorKind): boolean {
  return (
    kind === NetworkErrorKind.Offline ||
    kind === NetworkErrorKind.Unreachable ||
    kind === NetworkErrorKind.Timeout
  )
}

/** Kinds that should never produce a user-facing error message. */
export function isQuietNetworkError(kind: NetworkErrorKind): boolean {
  return kind === NetworkErrorKind.Offline || kind === NetworkErrorKind.Cancelled
}
