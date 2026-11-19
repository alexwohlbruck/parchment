import { expect, test, vi } from 'vitest'
import { MeshShadow } from './mesh-shadow'
import type { SunFrame } from '@/lib/map/sun-shadow'

test('shares shader programs across indexed bridges and releases them after the last bridge', () => {
  const gl = new Proxy({ createProgram: vi.fn(() => ({})), createBuffer: vi.fn(() => ({})),
    getExtension: () => null, getProgramParameter: () => true, getAttribLocation: () => 0,
    deleteProgram: vi.fn(), drawElements: vi.fn() } as Record<string, any>,
  { get: (target, name: string) => target[name] ?? (target[name] = vi.fn()) }) as unknown as WebGL2RenderingContext
  const a = new MeshShadow(), b = new MeshShadow(), indices = {} as WebGLBuffer
  a.prepare(gl)
  b.set(gl, {} as WebGLBuffer, 6, [0, 0], indices)
  expect(gl.createProgram).toHaveBeenCalledTimes(1)
  b.drawSunDepth(gl, { light: new Float64Array(16) } as SunFrame, 1.5)
  expect(gl.drawElements).toHaveBeenCalledWith(gl.TRIANGLES, 6, gl.UNSIGNED_INT, 0)
  a.delete(gl)
  expect(gl.deleteProgram).not.toHaveBeenCalled()
  b.delete(gl)
  expect(gl.deleteProgram).toHaveBeenCalledTimes(1)
})
