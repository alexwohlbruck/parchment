import { describe, expect, it } from 'vitest'
import { Matrix4, Vector3, Vector4 } from 'three'
import { enuToMercator, splitViewProjection } from './photorealistic-camera'

function clip(matrix: Matrix4, point: Vector3) {
  const v = new Vector4(point.x, point.y, point.z, 1).applyMatrix4(matrix)
  return new Vector3(v.x / v.w, v.y / v.w, v.z / v.w)
}

describe('enuToMercator', () => {
  it('puts the origin at its Mercator point and a kilometre north at a smaller y', () => {
    const m = new Matrix4().fromArray(enuToMercator(-80.84, 35.23, 0))
    const origin = new Vector3(0, 0, 0).applyMatrix4(m)
    const north = new Vector3(0, 1000, 0).applyMatrix4(m)
    expect(origin.x).toBeCloseTo((180 - 80.84) / 360, 9)
    expect(north.y).toBeLessThan(origin.y)
    expect(north.x).toBeCloseTo(origin.x, 12)
  })
})

describe('splitViewProjection', () => {
  // A MapLibre-like camera: Mercator world scaled to pixels, looking down at a point.
  const worldSize = 512 * 2 ** 16
  const projection = new Matrix4().makePerspective(-0.4, 0.4, 0.3, -0.3, 1, 1e6)
  const view = new Matrix4()
    .makeTranslation(0, 0, -800)
    .multiply(new Matrix4().makeRotationX(-0.6))
    .multiply(new Matrix4().makeScale(worldSize, worldSize, worldSize))
    .multiply(new Matrix4().makeTranslation(-0.2754, -0.4027, 0))
  const viewProjection = projection.clone().multiply(view)
  const toMercator = enuToMercator(-80.84, 35.23, 12)

  const split = splitViewProjection(projection.toArray(), viewProjection.toArray(), toMercator)
  const splitView = new Matrix4().fromArray(split.view)
  const splitProjection = new Matrix4().fromArray(split.projection)

  it('draws every point where MapLibre would', () => {
    const direct = viewProjection.clone().multiply(new Matrix4().fromArray(toMercator))
    const viaSplit = splitProjection.clone().multiply(splitView)
    for (const point of [new Vector3(0, 0, 0), new Vector3(120, -40, 30), new Vector3(-300, 250, 5)]) {
      const a = clip(direct, point)
      const b = clip(viaSplit, point)
      expect(b.x).toBeCloseTo(a.x, 6)
      expect(b.y).toBeCloseTo(a.y, 6)
      expect(b.z).toBeCloseTo(a.z, 6)
    }
  })

  it('keeps the view rigid, in metres, and MapLibre’s field of view', () => {
    const column = new Vector3().setFromMatrixColumn(splitView, 0)
    expect(column.length()).toBeCloseTo(1, 9)
    expect(split.projection[5]).toBeCloseTo(projection.elements[5], 12)
  })
})
