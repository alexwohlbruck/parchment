import { describe, test, expect } from 'vitest'
import { sunShadow, shadeLight, setSunOverride } from './building-shade'

/**
 * The cast shadows, the wall shading and the landmark models each take the sun
 * in a different frame. Get one sign wrong and a building is lit on the side
 * its own shadow falls.
 */
describe('sun direction', () => {
  const RAD = Math.PI / 180

  test('a south-east sun throws shadows north-west', () => {
    setSunOverride({ azimuth: 135 * RAD, altitude: 30 * RAD })
    const [x, y] = sunShadow(new Date(), 40.7, -74).offset
    setSunOverride(null)
    expect(x).toBeLessThan(0)
    expect(y).toBeGreaterThan(0)
  })

  test('the map light comes from where the sun is', () => {
    for (const azimuth of [45, 135, 225, 315]) {
      setSunOverride({ azimuth: azimuth * RAD, altitude: 30 * RAD })
      const sun = sunShadow(new Date(), 40.7, -74)
      setSunOverride(null)
      expect(shadeLight(sun.offset, sun.altitude).position[1]).toBeCloseTo(azimuth)
    }
  })
})
