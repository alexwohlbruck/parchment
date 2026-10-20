import { afterEach, describe, expect, it, vi } from 'vitest'
import { GlobeTexture } from './globe-texture'

function context() {
  const calls = {
    activeTexture: vi.fn(), createTexture: vi.fn(() => ({})), bindTexture: vi.fn(),
    texImage2D: vi.fn(), texParameteri: vi.fn(), generateMipmap: vi.fn(), deleteTexture: vi.fn(),
    R8: 33321, RED: 6403, RGB8: 32849, RGB: 6407, TEXTURE0: 33984,
    TEXTURE_2D: 3553, TEXTURE_MIN_FILTER: 10241, TEXTURE_WRAP_S: 10242,
    LINEAR: 9729, CLAMP_TO_EDGE: 33071,
  }
  return { calls, gl: calls as unknown as WebGL2RenderingContext }
}

afterEach(() => vi.unstubAllGlobals())

describe('globe texture', () => {
  it('loads once on demand, uploads a single-channel texture, and releases decoded pixels', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({ ok: true, blob: async () => new Blob() }))
    const bitmap = { close: vi.fn() }
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap))
    const lights = new GlobeTexture('/night-lights.webp', { singleChannel: true })
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

  it('uploads a colour panorama on its own texture unit and fades it in', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob() })))
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ close: vi.fn() })))
    const panorama = new GlobeTexture('/milky-way.webp')
    const repaint = vi.fn()
    expect(panorama.ready).toBe(false)
    panorama.load(repaint)
    await vi.waitFor(() => expect(repaint).toHaveBeenCalledOnce())
    const { gl, calls } = context()
    panorama.bind(gl, 1)
    expect(calls.activeTexture).toHaveBeenCalledWith(calls.TEXTURE0 + 1)
    expect(calls.texImage2D.mock.calls[1][2]).toBe(calls.RGB8)
    expect(calls.texImage2D.mock.calls[1][3]).toBe(calls.RGB)
    expect(panorama.ready).toBe(true)
    expect(panorama.blend).toBeLessThan(1)
    panorama.dispose(gl)
    expect(panorama.ready).toBe(false)
  })

  it('samples an atmosphere lookup linearly without wrapping or mipmaps', () => {
    const lookup = new GlobeTexture('/transmittance.png', { clamp: true })
    const { gl, calls } = context()
    lookup.bind(gl, 2)
    expect(calls.activeTexture).toHaveBeenCalledWith(calls.TEXTURE0 + 2)
    expect(calls.texParameteri).toHaveBeenCalledWith(calls.TEXTURE_2D, calls.TEXTURE_MIN_FILTER, calls.LINEAR)
    expect(calls.texParameteri).toHaveBeenCalledWith(calls.TEXTURE_2D, calls.TEXTURE_WRAP_S, calls.CLAMP_TO_EDGE)
    expect(calls.generateMipmap).not.toHaveBeenCalled()
    lookup.dispose(gl)
  })

  it('aborts a removed layer and closes an image that finishes decoding afterward', async () => {
    let finish!: (bitmap: { close: () => void }) => void
    const bitmap = { close: vi.fn() }
    const decode = vi.fn(() => new Promise(resolve => { finish = resolve }))
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({ ok: true, blob: async () => new Blob() }))
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('createImageBitmap', decode)
    const lights = new GlobeTexture('/night-lights.webp', { singleChannel: true })
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
    const lights = new GlobeTexture('/night-lights.webp', { singleChannel: true })
    lights.load(vi.fn())
    await new Promise(resolve => setTimeout(resolve, 0))
    const { gl, calls } = context()
    lights.bind(gl)
    expect(decode).not.toHaveBeenCalled()
    expect(calls.texImage2D).toHaveBeenCalledOnce()
    lights.dispose(gl)
  })
})
