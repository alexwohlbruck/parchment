import { describe, expect, test } from 'vitest'
import { eyeOf } from './mesh-program'

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
