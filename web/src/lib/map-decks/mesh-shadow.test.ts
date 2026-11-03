import { describe, expect, test, vi } from 'vitest'
import { groundBeneath, MeshShadow } from './mesh-shadow'
import { metresPerUnit, type Point } from './decks'

describe('groundBeneath', () => {
  const origin: Point = [0.25, 0.4]
  const unit = metresPerUnit(origin[1])

  test('reads the ground under each vertex once per spot, stretched and in mercator units', () => {
    const reads: Point[] = []
    const at = (p: Point) => {
      reads.push(p)
      return p[0] > origin[0] ? 20 : 10
    }
    // A pier's foot and head on one spot, then a vertex a few hundred metres east.
    const position = [0, 0, 0, 0, 0, 9, 1e-5, 0, 9]
    const ground = groundBeneath(position, 3, origin, at, 1.5)
    expect(reads).toHaveLength(2)
    expect(reads[0]).toEqual(origin)
    expect(ground[0] * unit).toBeCloseTo(15, 3)
    expect(ground[1]).toBe(ground[0])
    expect(ground[2] * unit).toBeCloseTo(30, 3)
  })

  test('leaves a vertex with no ground known standing on itself, so it casts nothing', () => {
    expect([...groundBeneath([0, 0, 7, 0, 1e-5, 7], 2, origin, p => (p[1] > origin[1] ? NaN : null))]).toEqual([7, 7])
  })
})

test('shares shader programs across indexed bridges and releases them after the last bridge', () => {
  const gl = new Proxy({ createProgram: vi.fn(() => ({})), createBuffer: vi.fn(() => ({})),
    getExtension: () => null, getProgramParameter: () => true, getAttribLocation: () => 0,
    deleteProgram: vi.fn(), drawElements: vi.fn() } as Record<string, any>,
  { get: (target, name: string) => target[name] ?? (target[name] = vi.fn()) }) as unknown as WebGL2RenderingContext
  const a = new MeshShadow(), b = new MeshShadow(), indices = {} as WebGLBuffer
  a.prepare(gl)
  b.set(gl, {} as WebGLBuffer, 6, new Float32Array(4), [0, 0], 1, indices)
  expect(gl.createProgram).toHaveBeenCalledTimes(2)
  b.drawShadow(gl, { matrix: new Float32Array(16), shear: [0, 0] }, 1.5)
  expect(gl.drawElements).toHaveBeenCalledWith(gl.TRIANGLES, 6, gl.UNSIGNED_INT, 0)
  a.delete(gl)
  expect(gl.deleteProgram).not.toHaveBeenCalled()
  b.delete(gl)
  expect(gl.deleteProgram).toHaveBeenCalledTimes(2)
})
