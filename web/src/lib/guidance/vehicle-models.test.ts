import { describe, expect, it } from 'vitest'
import { vehicleMesh, VERTEX_FLOATS } from './vehicle-models'
import type { VehicleModel } from './vehicle-indicator'

const MODELS: VehicleModel[] = ['hatchback', 'suv', 'pickup', 'bike']

function bounds(vertices: Float32Array) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < vertices.length; i += VERTEX_FLOATS)
    for (let c = 0; c < 3; c++) {
      min[c] = Math.min(min[c], vertices[i + c])
      max[c] = Math.max(max[c], vertices[i + c])
    }
  return { min, max }
}

describe('vehicleMesh', () => {
  it.each(MODELS)('%s stands on the ground, centred, at its stated size', model => {
    const mesh = vehicleMesh(model)
    const { min, max } = bounds(mesh.vertices)
    expect(min[2]).toBeCloseTo(0, 2)
    expect(max[1] - min[1]).toBeGreaterThan(mesh.length * 0.95)
    expect(max[1] - min[1]).toBeLessThan(mesh.length * 1.05)
    expect(Math.abs(max[0] + min[0])).toBeLessThan(0.01)
    expect(max[0] - min[0]).toBeLessThan(mesh.width * 1.1)
  })

  it.each(MODELS)('%s is a small triangle list with unit normals', model => {
    const { vertices, count } = vehicleMesh(model)
    expect(count % 3).toBe(0)
    expect(count / 3).toBeLessThan(1500)
    for (let i = 0; i < vertices.length; i += VERTEX_FLOATS)
      expect(Math.hypot(vertices[i + 3], vertices[i + 4], vertices[i + 5])).toBeCloseTo(1, 4)
  })

  it('faces the roof up and the nose forward', () => {
    const { vertices } = vehicleMesh('hatchback')
    const { max } = bounds(vertices)
    let up = 0
    let forward = 0
    for (let i = 0; i < vertices.length; i += VERTEX_FLOATS) {
      if (vertices[i + 2] > max[2] - 0.001) up += Math.sign(vertices[i + 5])
      if (vertices[i + 1] > max[1] - 0.001) forward += Math.sign(vertices[i + 4])
    }
    expect(up).toBeGreaterThan(0)
    expect(forward).toBeGreaterThan(0)
  })

  it('marks the body as paint', () => {
    const { vertices } = vehicleMesh('suv')
    let painted = 0
    for (let i = 9; i < vertices.length; i += VERTEX_FLOATS) painted += vertices[i]
    expect(painted).toBeGreaterThan(0)
  })
})
