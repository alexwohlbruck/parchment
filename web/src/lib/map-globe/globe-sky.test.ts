import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CustomRenderMethodInput, Map } from 'maplibre-gl'
import { GlobeSky } from './globe-sky'

function context() {
  const calls = {
    createProgram: vi.fn(() => ({})), createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(), compileShader: vi.fn(), getShaderParameter: vi.fn(() => true),
    deleteShader: vi.fn(), attachShader: vi.fn(), linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true), deleteProgram: vi.fn(),
    createVertexArray: vi.fn(() => ({})), deleteVertexArray: vi.fn(),
    getUniformLocation: vi.fn((_program, name) => name),
    useProgram: vi.fn(), bindVertexArray: vi.fn(), disable: vi.fn(), enable: vi.fn(),
    depthMask: vi.fn(), blendFunc: vi.fn(), uniformMatrix4fv: vi.fn(), uniformMatrix3fv: vi.fn(), uniform1f: vi.fn(), uniform3fv: vi.fn(), uniform1i: vi.fn(),
    activeTexture: vi.fn(), createTexture: vi.fn(() => ({})), bindTexture: vi.fn(), texImage2D: vi.fn(),
    texParameteri: vi.fn(), generateMipmap: vi.fn(), deleteTexture: vi.fn(),
    drawArrays: vi.fn(), getShaderInfoLog: vi.fn(() => 'compile error'),
  }
  return { calls, gl: calls as unknown as WebGL2RenderingContext }
}

const input = (transition: number) => ({
  defaultProjectionData: { projectionTransition: transition, mainMatrix: new Float32Array(16) },
}) as unknown as CustomRenderMethodInput

const map = (zoom = 2) => ({ getZoom: () => zoom, getPixelRatio: () => 2, getLayer: () => undefined }) as unknown as Map

beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))))
afterEach(() => vi.unstubAllGlobals())

describe('GlobeSky', () => {
  it('does no GPU work for Mercator or a close map view', () => {
    const { gl, calls } = context()
    const sky = new GlobeSky()
    sky.onAdd(map(), gl)
    sky.render(gl, input(0))
    sky.onRemove(map(), gl)
    sky.onAdd(map(6), gl)
    sky.render(gl, input(1))
    expect(calls.drawArrays).not.toHaveBeenCalled()
    expect(calls.useProgram).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('fades the globe effect while preserving display pixel density', () => {
    const { gl, calls } = context()
    const sky = new GlobeSky()
    const inverse = new Float32Array(16)
    vi.stubGlobal('DOMMatrix', {
      fromFloat32Array: () => ({ inverse: () => ({ toFloat32Array: () => inverse }) }),
    })
    sky.onAdd(map(5), gl)
    sky.render(gl, input(1))
    expect(calls.uniform1f).toHaveBeenCalledWith('u_opacity', 0.5)
    expect(calls.uniform1f).toHaveBeenCalledWith('u_pixel_ratio', 2)
    expect(calls.uniformMatrix4fv).toHaveBeenCalledWith('u_inverse', false, inverse)
    expect(calls.depthMask).toHaveBeenCalledWith(false)
    expect(calls.drawArrays).toHaveBeenCalledOnce()
  })

  it('uses the Day & Night toggle and keeps satellite nights darker', () => {
    const { gl, calls } = context()
    let visible = true
    const host = {
      getZoom: () => 2, getPixelRatio: () => 1,
      getLayer: () => ({}), getLayoutProperty: () => visible ? 'visible' : 'none',
    } as unknown as Map
    vi.stubGlobal('DOMMatrix', {
      fromFloat32Array: () => ({ inverse: () => ({ toFloat32Array: () => new Float32Array(16) }) }),
    })
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const sky = new GlobeSky(() => true)
    sky.onAdd(host, gl)
    sky.render(gl, input(1))
    expect(calls.uniform1f).toHaveBeenCalledWith('u_lighting', 1)
    expect(calls.uniform1f).toHaveBeenCalledWith('u_night_brightness', 0.09)
    expect(calls.uniform3fv).toHaveBeenCalledOnce()
    visible = false
    sky.render(gl, input(1))
    expect(calls.uniform1f).toHaveBeenCalledWith('u_lighting', 0)
  })

  it('releases resources on a style change and can be added again', () => {
    const { gl, calls } = context()
    const sky = new GlobeSky()
    sky.onAdd(map(), gl)
    expect(calls.deleteShader).toHaveBeenCalledTimes(2)
    sky.onRemove(map(), gl)
    expect(calls.deleteProgram).toHaveBeenCalledOnce()
    expect(calls.deleteVertexArray).toHaveBeenCalledOnce()
    sky.render(gl, input(1))
    expect(calls.drawArrays).not.toHaveBeenCalled()
    sky.onAdd(map(), gl)
    expect(calls.createProgram).toHaveBeenCalledTimes(2)
  })

  it('keeps cloud, ocean, and city-light imagery off the standard map', () => {
    const { gl, calls } = context()
    const host = {
      getZoom: () => 2, getPixelRatio: () => 1,
      getLayer: () => ({}), getLayoutProperty: () => 'visible',
    } as unknown as Map
    vi.stubGlobal('DOMMatrix', {
      fromFloat32Array: () => ({ inverse: () => ({ toFloat32Array: () => new Float32Array(16) }) }),
    })
    let satellite = true
    const sky = new GlobeSky(() => satellite)
    sky.onAdd(host, gl)
    sky.render(gl, input(1))
    expect(vi.mocked(fetch).mock.calls.some(([url]) => /clouds\.(webp|jpg)/.test(String(url)))).toBe(true)
    vi.mocked(fetch).mockClear()
    satellite = false
    sky.render(gl, input(1))
    expect(calls.uniform1f).toHaveBeenCalledWith('u_cloud_blend', 0)
    expect(calls.uniform1f).toHaveBeenCalledWith('u_lights_blend', 0)
    expect(calls.uniform1f).toHaveBeenCalledWith('u_ocean_blend', 0)
    expect(fetch).not.toHaveBeenCalled()
    sky.onRemove(host, gl)
    sky.onAdd(host, gl)
    sky.render(gl, input(1))
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url))
    expect(urls.some(url => /clouds|night-lights|ocean-mask/.test(url))).toBe(false)
    sky.onRemove(host, gl)
  })

  it('cancels pending globe imagery and releases all texture slots on removal', () => {
    const { gl, calls } = context()
    vi.stubGlobal('DOMMatrix', {
      fromFloat32Array: () => ({ inverse: () => ({ toFloat32Array: () => new Float32Array(16) }) }),
    })
    const sky = new GlobeSky(() => true)
    sky.onAdd(map(), gl)
    sky.render(gl, input(1))
    const requests = vi.mocked(fetch).mock.calls
    expect(requests.some(([url]) => /clouds\.(webp|jpg)/.test(String(url)))).toBe(true)
    expect(calls.uniform1i).toHaveBeenCalledWith('u_clouds', 3)
    sky.onRemove(map(), gl)
    for (const [, options] of requests) expect(options?.signal?.aborted).toBe(true)
    expect(calls.deleteTexture).toHaveBeenCalledTimes(5)
  })

  it('cleans up both shaders and the program if the fragment shader fails', () => {
    const { gl, calls } = context()
    calls.getShaderParameter.mockReturnValueOnce(true).mockReturnValueOnce(false)
    expect(() => new GlobeSky().onAdd(map(), gl)).toThrow('compile error')
    expect(calls.deleteShader).toHaveBeenCalledTimes(2)
    expect(calls.deleteProgram).toHaveBeenCalledOnce()
  })
})
