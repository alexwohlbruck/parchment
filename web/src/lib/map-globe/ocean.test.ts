import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

describe('globe ocean mask', () => {
  it('keeps the glint on oceans and off land, including the antimeridian', async () => {
    const path = resolve(dirname(fileURLToPath(import.meta.url)), '../../assets/map-globe/ocean-mask.webp')
    const { data, info } = await sharp(path).greyscale().raw().toBuffer({ resolveWithObject: true })
    const water = (lon: number, lat: number) => {
      const x = Math.floor((lon + 180) / 360 * info.width)
      const y = Math.floor((90 - lat) / 180 * info.height)
      return data[y * info.width + x]
    }
    for (const [lon, lat] of [[-140, 0], [-30, 25], [80, -25], [179, 0], [-179, 0]]) expect(water(lon, lat)).toBe(255)
    for (const [lon, lat] of [[-100, 40], [20, 10], [100, 40], [135, -25], [0, -85]]) expect(water(lon, lat)).toBe(0)
  })
})
