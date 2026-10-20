import { afterEach, describe, expect, it, vi } from 'vitest'
import { NightLights } from './night-lights'

function context() {
  const calls = {
    activeTexture: vi.fn(), createTexture: vi.fn(() => ({})), bindTexture: vi.fn(),
    texImage2D: vi.fn(), texParameteri: vi.fn(), generateMipmap: vi.fn(), deleteTexture: vi.fn(),
    R8: 33321, RED: 6403,
  }
  return { calls, gl: calls as unknown as WebGL2RenderingContext }
}

afterEach(() => vi.unstubAllGlobals())

describe('night-light texture', () => {
  it('loads once on demand, uploads a single-channel texture, and releases decoded pixels', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({ ok: true, blob: async () => new Blob() }))
    const bitmap = { close: vi.fn() }
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap))
    const lights = new NightLights()
    const { gl, calls } = context()
    lights.bind(gl)
    expect(fetch).not.toHaveBeenCalled()
    const repaint = vi.fn()
    lights.load(repaint)
    lights.load(repaint)
    await vi.waitFor(() => expect(repaint).toHaveBeenCalledOnce())
    expect(fetch).toHaveBeenCalledOnce()
    lights.bind(gl)
    expect(calls.texImage2D.mock.calls[1][2]).toBe(calls.R8)
    expect(calls.texImage2D.mock.calls[1][3]).toBe(calls.RED)
    expect(bitmap.close).toHaveBeenCalledOnce()
    lights.bind(gl)
    expect(calls.texImage2D).toHaveBeenCalledTimes(2)
    lights.dispose(gl)
    expect(calls.deleteTexture).toHaveBeenCalledOnce()
  })

  it('aborts a removed layer and closes an image that finishes decoding afterward', async () => {
    let finish!: (bitmap: { close: () => void }) => void
    const bitmap = { close: vi.fn() }
    const decode = vi.fn(() => new Promise(resolve => { finish = resolve }))
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({ ok: true, blob: async () => new Blob() }))
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('createImageBitmap', decode)
    const lights = new NightLights()
    const repaint = vi.fn()
    lights.load(repaint)
    await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce())
    lights.dispose(context().gl)
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true)
    finish(bitmap)
    await vi.waitFor(() => expect(bitmap.close).toHaveBeenCalledOnce())
    expect(repaint).not.toHaveBeenCalled()
  })

  it('keeps the black fallback when imagery is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })))
    const decode = vi.fn()
    vi.stubGlobal('createImageBitmap', decode)
    const lights = new NightLights()
    lights.load(vi.fn())
    await new Promise(resolve => setTimeout(resolve, 0))
    const { gl, calls } = context()
    lights.bind(gl)
    expect(decode).not.toHaveBeenCalled()
    expect(calls.texImage2D).toHaveBeenCalledOnce()
    lights.dispose(gl)
  })
})
