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
  info: vi.fn(),
  message: vi.fn(),
  loading: vi.fn(),
  dismiss: vi.fn(),
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
    const options = sonner.error.mock.calls[0][1]
    expect(options).not.toHaveProperty('cause')
    expect(options).not.toHaveProperty('force')
    expect(options.description).toBe('d')
  })

  it('lets success toasts through while offline', () => {
    reportServerUnreachable()
    toast.success('Saved')
    expect(sonner.success).toHaveBeenCalledOnce()
  })
})

describe('toast keys', () => {
  beforeEach(() => vi.clearAllMocks())

  const idOf = (mock: typeof sonner.success, call = 0) => mock.mock.calls[call][1].id

  it('gives a repeated message the same id', () => {
    toast.success('Copied')
    toast.success('Copied')
    toast.success('Saved')
    expect(idOf(sonner.success, 0)).toBe(idOf(sonner.success, 1))
    expect(idOf(sonner.success, 0)).not.toBe(idOf(sonner.success, 2))
  })

  it('keeps toasts with actions apart', () => {
    const action = { label: 'View', onClick: () => {} }
    toast.success('Saved', { action })
    toast.success('Saved', { action })
    expect(idOf(sonner.success, 0)).toBeUndefined()
  })

  it('respects an explicit id', () => {
    toast.info('Copied', { id: 'clipboard' })
    expect(idOf(sonner.info)).toBe('clipboard')
  })

  it('folds a service error into the toast for the same failed request', () => {
    const error = new Error('500')
    toast.error('Server error', { cause: error, description: 'Try again later' })
    toast.error('Failed to save route', { cause: error })
    const [first, second] = sonner.error.mock.calls
    expect(second[1].id).toBe(first[1].id)
    expect(second[0]).toBe('Failed to save route')
    expect(second[1].description).toBe('Try again later')
  })

  it('lets an aggregate id replace a request toast', () => {
    const cause = new Error('Forbidden')
    toast.error('Request failed', { cause })
    const previous = idOf(sonner.error)
    toast.error('Two changes failed', { cause, id: 'sync-failed', description: '' })
    expect(idOf(sonner.error, 1)).toBe('sync-failed')
    expect(sonner.dismiss).toHaveBeenCalledWith(previous)
    expect(sonner.error.mock.calls[1][1].description).toBe('')
  })

  it('keeps unrelated failures apart', () => {
    toast.error('Failed', { cause: new Error('a') })
    toast.error('Failed', { cause: new Error('b') })
    expect(idOf(sonner.error, 0)).not.toBe(idOf(sonner.error, 1))
  })
})

describe('toast.promise', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetConnectivityForTests()
  })
  afterEach(() => _resetConnectivityForTests())

  const loadingId = () => sonner.loading.mock.calls[0][1].id

  it('turns the loading toast into a success and resolves with the value', async () => {
    const value = await toast.promise(Promise.resolve(3), {
      loading: 'Saving',
      success: count => `Saved ${count}`,
    })
    expect(value).toBe(3)
    expect(sonner.loading).toHaveBeenCalledWith('Saving', expect.objectContaining({ id: loadingId() }))
    expect(sonner.success).toHaveBeenCalledWith('Saved 3', expect.objectContaining({ id: loadingId() }))
  })

  it('starts lazy work and closes quietly without a success message', async () => {
    const work = vi.fn(async () => 'ok')
    await toast.promise(work, { loading: 'Saving', success: () => undefined })
    expect(work).toHaveBeenCalledOnce()
    expect(sonner.success).not.toHaveBeenCalled()
    expect(sonner.dismiss).toHaveBeenCalledWith(loadingId())
  })

  it('clears the loading description from the outcome', async () => {
    await toast.promise(Promise.resolve(), { loading: 'Restoring', success: 'Ready' }, { description: 'Tap again' })
    expect(sonner.loading.mock.calls[0][1].description).toBe('Tap again')
    expect(sonner.success.mock.calls[0][1].description).toBeUndefined()
  })

  it('shows the error in place, keeps the request detail, and rethrows', async () => {
    const error = new Error('500')
    toast.error('Server error', { cause: error, description: 'Try again later' })
    const requestId = sonner.error.mock.calls[0][1].id
    await expect(
      toast.promise(Promise.reject(error), { loading: 'Saving', error: "Couldn't save" }),
    ).rejects.toBe(error)
    const [message, options] = sonner.error.mock.calls[1]
    expect(message).toBe("Couldn't save")
    expect(options.id).toBe(loadingId())
    expect(options.description).toBe('Try again later')
    expect(sonner.dismiss).toHaveBeenCalledWith(requestId)
  })

  it('drops the loading toast when the error has no message of its own', async () => {
    await expect(
      toast.promise(Promise.reject(new Error('x')), { loading: 'Saving' }),
    ).rejects.toThrow('x')
    expect(sonner.error).not.toHaveBeenCalled()
    expect(sonner.dismiss).toHaveBeenCalledWith(loadingId())
  })

  it('drops the loading toast when the error is suppressed offline', async () => {
    reportServerUnreachable()
    await expect(
      toast.promise(Promise.reject(new Error('x')), { loading: 'Saving', error: 'Failed' }),
    ).rejects.toThrow()
    expect(sonner.error).not.toHaveBeenCalled()
    expect(sonner.dismiss).toHaveBeenCalledWith(loadingId())
  })
})
