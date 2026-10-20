import { afterEach, describe, expect, it, vi } from 'vitest'
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
    depthMask: vi.fn(), blendFunc: vi.fn(), uniformMatrix4fv: vi.fn(), uniform1f: vi.fn(),
    drawArrays: vi.fn(), getShaderInfoLog: vi.fn(() => 'compile error'),
  }
  return { calls, gl: calls as unknown as WebGL2RenderingContext }
}

const input = (transition: number) => ({
  defaultProjectionData: { projectionTransition: transition, mainMatrix: new Float32Array(16) },
}) as unknown as CustomRenderMethodInput

const map = (zoom = 2) => ({ getZoom: () => zoom, getPixelRatio: () => 2 }) as Map

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

  it('cleans up both shaders and the program if the fragment shader fails', () => {
    const { gl, calls } = context()
    calls.getShaderParameter.mockReturnValueOnce(true).mockReturnValueOnce(false)
    expect(() => new GlobeSky().onAdd(map(), gl)).toThrow('compile error')
    expect(calls.deleteShader).toHaveBeenCalledTimes(2)
    expect(calls.deleteProgram).toHaveBeenCalledOnce()
  })
})
