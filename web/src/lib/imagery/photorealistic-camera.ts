import { Matrix4, Vector3 } from 'three'

const EARTH_CIRCUMFERENCE = 40_075_016.686

/**
 * East-north-up metres around (lng, lat) into MapLibre's Mercator world, where
 * x and y run 0–1 and height is in the same units, raised by `groundOffset`.
 * Column-major, as MapLibre and three hand matrices around.
 */
export function enuToMercator(lng: number, lat: number, groundOffset: number): number[] {
  const perMetre = 1 / (EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180))
  const x = (180 + lng) / 360
  const y = (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360
  return [perMetre, 0, 0, 0, 0, -perMetre, 0, 0, 0, 0, perMetre, 0, x, y, perMetre * groundOffset, 1]
}

/**
 * Split MapLibre's projection and Mercator view-projection into a camera for a
 * frame in metres: a rigid view and a projection that together draw the same.
 *
 * `projection⁻¹ · viewProjection · toMercator` is that rigid view scaled by the
 * pixels in a metre. The scale moves into the projection, where a perspective
 * matrix absorbs it in its translation column alone, so the field of view the
 * tiles read their level of detail from is MapLibre's own.
 */
export function splitViewProjection(
  projection: ArrayLike<number>,
  viewProjection: ArrayLike<number>,
  toMercator: ArrayLike<number>,
): { view: number[]; projection: number[] } {
  const p = new Matrix4().fromArray(projection as number[])
  const scaled = p
    .clone()
    .invert()
    .multiply(new Matrix4().fromArray(viewProjection as number[]))
    .multiply(new Matrix4().fromArray(toMercator as number[]))
  const k = new Vector3().setFromMatrixColumn(scaled, 0).length()

  const view = scaled.toArray()
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 3; row++) view[column * 4 + row] /= k
  }
  const split = p.toArray()
  for (let row = 0; row < 4; row++) split[12 + row] /= k
  return { view, projection: split }
}
