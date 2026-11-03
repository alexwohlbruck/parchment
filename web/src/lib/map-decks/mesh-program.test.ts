import { describe, expect, test, vi } from 'vitest'
import { bindMesh, eyeOf, programReady, uploadMesh } from './mesh-program'

/** A perspective camera at `eye` looking down -z, as a column-major matrix. */
function camera(eye: [number, number, number]): number[] {
  const [f, near, far] = [1.5, 0.1, 100]
  const projection = [f, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0]
  const view = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -eye[0], -eye[1], -eye[2], 1]
  const out = new Array(16).fill(0)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += projection[k * 4 + r] * view[c * 4 + k]
  return out
}

describe('eyeOf', () => {
  test('finds the camera a projection looks from', () => {
    const eye = eyeOf(camera([3, -2, 7]))!
    expect(eye[0]).toBeCloseTo(3, 6)
    expect(eye[1]).toBeCloseTo(-2, 6)
    expect(eye[2]).toBeCloseTo(7, 6)
  })

  test('has none for an orthographic projection', () => {
    expect(eyeOf([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])).toBeNull()
  })
})

test('polls parallel compilation without blocking on link status', () => {
  const program = {} as WebGLProgram
  let complete = false
  const getProgramParameter = vi.fn((_program, status) => status === 1 ? complete : true)
  const gl = { getExtension: () => ({ COMPLETION_STATUS_KHR: 1 }), getProgramParameter, LINK_STATUS: 2 } as unknown as WebGL2RenderingContext
  expect(programReady(gl, program)).toBe(false)
  expect(getProgramParameter).not.toHaveBeenCalledWith(program, 2)
  complete = true
  expect(programReady(gl, program)).toBe(true)
  getProgramParameter.mockClear()
  expect(programReady(gl, program)).toBe(true)
  expect(getProgramParameter).not.toHaveBeenCalled()
})

test('reads byte normals normalised and byte palette slots as they are, without widening them to floats', () => {
  const calls: unknown[][] = []
  const gl = new Proxy({ BYTE: 0x1400, UNSIGNED_BYTE: 0x1401, FLOAT: 0x1406, drawingBufferWidth: 1, drawingBufferHeight: 1,
    createBuffer: () => ({}), getAttribLocation: (_: unknown, name: string) => ['a_position', 'a_normal', 'a_color', 'a_low'].indexOf(name),
    bufferData: (...args: unknown[]) => calls.push(['bufferData', ...args]), vertexAttribPointer: (...args: unknown[]) => calls.push(['pointer', ...args]),
  } as Record<string, any>, { get: (target, name: string) => target[name] ?? (target[name] = () => null) }) as unknown as WebGL2RenderingContext
  const normal = Int8Array.of(0, 0, 127), color = Uint8Array.of(3, 0, 0)
  const buffers = uploadMesh(gl, { position: new Float32Array(3), normal, color, low: color })
  expect(calls.filter(c => c[0] === 'bufferData').map(c => c[2])).toContain(normal)
  bindMesh(gl, {} as WebGLProgram, buffers, new Float32Array(16), [0, 0, 1])
  const pointers = calls.filter(c => c[0] === 'pointer')
  expect(pointers.find(c => c[1] === 1)?.slice(3, 5)).toEqual([0x1400, true])
  expect(pointers.find(c => c[1] === 2)?.slice(3, 5)).toEqual([0x1401, false])
  expect(pointers.find(c => c[1] === 0)?.slice(3, 5)).toEqual([0x1406, false])
})
