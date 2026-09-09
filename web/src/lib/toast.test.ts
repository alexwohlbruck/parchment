/**
 * The offline toast policy: while offline, the app says so once (sidebar
 * chip + empty states) rather than firing a red toast per failed fetch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'

const sonner = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('vue-sonner', () => ({ toast: Object.assign(vi.fn(), sonner) }))

import {
  _resetConnectivityForTests,
  reportServerReachable,
  reportServerUnreachable,
} from './connectivity'
import { OfflineRequestError } from './network-errors'
import { toast } from './toast'

const config = { method: 'get', url: '/places/details' } as InternalAxiosRequestConfig

describe('toast.error offline policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetConnectivityForTests()
  })
  afterEach(() => _resetConnectivityForTests())

  it('shows errors normally while online', () => {
    toast.error('Failed to fetch collections')
    expect(sonner.error).toHaveBeenCalledOnce()
  })

  it('drops errors while offline', () => {
    reportServerUnreachable()
    toast.error('Failed to fetch collections')
    expect(sonner.error).not.toHaveBeenCalled()
  })

  it('still shows errors offline when forced', () => {
    reportServerUnreachable()
    toast.error('Could not save to this device', { force: true })
    expect(sonner.error).toHaveBeenCalledOnce()
  })

  it('drops an offline-caused error even after reconnecting', () => {
    // The catch block can run after connectivity returns; the error itself
    // still says the request never went out.
    reportServerUnreachable()
    const error = new OfflineRequestError(config)
    reportServerReachable()
    toast.error(error.message, { cause: error })
    expect(sonner.error).not.toHaveBeenCalled()
  })

  it('shows a genuine server error that arrived after reconnecting', () => {
    const error = new AxiosError(
      'nope',
      undefined,
      config,
      {},
      { status: 500, statusText: '', headers: {}, config, data: {} } as never,
    )
    toast.error('Something broke', { cause: error })
    expect(sonner.error).toHaveBeenCalledOnce()
  })

  it('never forwards its own options to sonner', () => {
    toast.error('msg', { cause: new Error('x'), force: true, description: 'd' })
    expect(sonner.error).toHaveBeenCalledWith('msg', { description: 'd' })
  })

  it('lets success toasts through while offline', () => {
    reportServerUnreachable()
    toast.success('Saved')
    expect(sonner.success).toHaveBeenCalledOnce()
  })
})
