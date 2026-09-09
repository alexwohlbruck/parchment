import { describe, expect, it } from 'vitest'
import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import {
  NetworkErrorKind,
  OfflineRequestError,
  classifyNetworkError,
  getNetworkErrorKind,
  isChunkLoadError,
  isQuietNetworkError,
  isRetriableNetworkError,
  tagNetworkError,
} from './network-errors'

const config = { method: 'get', url: '/x' } as InternalAxiosRequestConfig

function axiosError(opts: {
  code?: string
  status?: number
  request?: unknown
}): AxiosError {
  const response = opts.status
    ? { status: opts.status, statusText: '', headers: {}, config, data: {} }
    : undefined
  return new AxiosError(
    'boom',
    opts.code,
    config,
    opts.request ?? (opts.status ? {} : undefined),
    response as never,
  )
}

describe('classifyNetworkError', () => {
  it('classifies 4xx responses as client errors', () => {
    expect(classifyNetworkError(axiosError({ status: 404 }))).toBe(
      NetworkErrorKind.Client,
    )
    expect(classifyNetworkError(axiosError({ status: 422 }))).toBe(
      NetworkErrorKind.Client,
    )
  })

  it('classifies 5xx responses as server errors', () => {
    expect(classifyNetworkError(axiosError({ status: 500 }))).toBe(
      NetworkErrorKind.Server,
    )
    expect(classifyNetworkError(axiosError({ status: 503 }))).toBe(
      NetworkErrorKind.Server,
    )
  })

  it('classifies axios timeouts', () => {
    expect(classifyNetworkError(axiosError({ code: 'ECONNABORTED' }))).toBe(
      NetworkErrorKind.Timeout,
    )
    expect(classifyNetworkError(axiosError({ code: 'ETIMEDOUT' }))).toBe(
      NetworkErrorKind.Timeout,
    )
  })

  it('splits responseless failures by whether the device has a network', () => {
    const err = axiosError({ code: 'ERR_NETWORK', request: {} })
    expect(classifyNetworkError(err, { navigatorOnline: true })).toBe(
      NetworkErrorKind.Unreachable,
    )
    expect(classifyNetworkError(err, { navigatorOnline: false })).toBe(
      NetworkErrorKind.Offline,
    )
  })

  it('classifies cancellations as cancelled', () => {
    expect(classifyNetworkError(new axios.CanceledError('cancel'))).toBe(
      NetworkErrorKind.Cancelled,
    )
    expect(
      classifyNetworkError(new DOMException('aborted', 'AbortError')),
    ).toBe(NetworkErrorKind.Cancelled)
  })

  it('classifies suppressed offline reads as offline', () => {
    expect(classifyNetworkError(new OfflineRequestError(config))).toBe(
      NetworkErrorKind.Offline,
    )
  })

  it('falls back to unknown for non-network errors', () => {
    expect(classifyNetworkError(new Error('undefined is not a function'))).toBe(
      NetworkErrorKind.Unknown,
    )
    expect(classifyNetworkError(undefined)).toBe(NetworkErrorKind.Unknown)
  })
})

describe('tagNetworkError / getNetworkErrorKind', () => {
  it('prefers the stamped kind over re-classification', () => {
    const err = new Error('anything')
    tagNetworkError(err, NetworkErrorKind.Timeout)
    expect(getNetworkErrorKind(err)).toBe(NetworkErrorKind.Timeout)
  })

  it('classifies unstamped errors on the fly', () => {
    expect(getNetworkErrorKind(axiosError({ status: 500 }))).toBe(
      NetworkErrorKind.Server,
    )
  })
})

describe('kind groupings', () => {
  it('treats offline, unreachable and timeout as retriable', () => {
    expect(isRetriableNetworkError(NetworkErrorKind.Offline)).toBe(true)
    expect(isRetriableNetworkError(NetworkErrorKind.Unreachable)).toBe(true)
    expect(isRetriableNetworkError(NetworkErrorKind.Timeout)).toBe(true)
    expect(isRetriableNetworkError(NetworkErrorKind.Client)).toBe(false)
    expect(isRetriableNetworkError(NetworkErrorKind.Server)).toBe(false)
  })

  it('keeps offline and cancelled quiet', () => {
    expect(isQuietNetworkError(NetworkErrorKind.Offline)).toBe(true)
    expect(isQuietNetworkError(NetworkErrorKind.Cancelled)).toBe(true)
    expect(isQuietNetworkError(NetworkErrorKind.Unreachable)).toBe(false)
  })
})

describe('isChunkLoadError', () => {
  it('recognises the browsers’ wordings for a failed view chunk', () => {
    expect(
      isChunkLoadError(
        new Error('Failed to fetch dynamically imported module: /assets/Dashboard-a1b2.js'),
      ),
    ).toBe(true)
    expect(
      isChunkLoadError(new Error('Importing a module script failed.')),
    ).toBe(true)
    expect(
      isChunkLoadError(new TypeError('error loading dynamically imported module')),
    ).toBe(true)
  })

  it('ignores unrelated errors', () => {
    expect(isChunkLoadError(new Error('Network Error'))).toBe(false)
    expect(isChunkLoadError(undefined)).toBe(false)
  })
})
