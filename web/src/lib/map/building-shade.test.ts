import { describe, test, expect } from 'vitest'
import SunCalc from 'suncalc'
import { castShadow, nightShadow, sunShadow, shadeLight, setSunOverride } from './building-shade'

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

describe('cast shadow', () => {
  const RAD = Math.PI / 180

  test('is the sun at full strength by day', () => {
    setSunOverride({ azimuth: 135 * RAD, altitude: 40 * RAD })
    const shadow = castShadow(new Date(), 40.7, -74)
    setSunOverride(null)
    expect(shadow.strength).toBe(1)
  })

  test('still falls at night, softer, from the moon or the sky', () => {
    setSunOverride({ azimuth: 135 * RAD, altitude: -20 * RAD })
    const shadow = castShadow(new Date(), 40.7, -74)
    setSunOverride(null)
    expect(shadow.strength).toBeGreaterThan(0)
    expect(shadow.strength).toBeLessThan(1)
    expect(shadow.altitude).toBeGreaterThan(0)
  })

  test('falls away from the moon while it is well up', () => {
    const start = Date.UTC(2026, 0, 1)
    let date = new Date(start)
    for (let h = 0; h < 24 * 30 && SunCalc.getMoonPosition(date, 40.7, -74).altitude < 30 * RAD; h++) date = new Date(start + h * 3600000)
    const moon = SunCalc.getMoonPosition(date, 40.7, -74)
    const shadow = nightShadow(date, 40.7, -74)
    const bearing = moon.azimuth + Math.PI
    expect(shadow.offset[0]).toBeCloseTo(-Math.sin(bearing))
    expect(shadow.offset[1]).toBeCloseTo(-Math.cos(bearing))
    expect(shadow.altitude).toBeCloseTo(moon.altitude)
  })
})
