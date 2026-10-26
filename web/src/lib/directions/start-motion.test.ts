import { describe, expect, it } from 'vitest'
import { startMotion, travellerHeading } from './start-motion'

describe('travellerHeading', () => {
  it('prefers the GPS course while moving', () => {
    expect(travellerHeading({ course: 80, speed: 5, compass: 200 })).toBe(80)
  })

  it('falls back to the compass when still', () => {
    expect(travellerHeading({ course: 80, speed: 0.3, compass: 200 })).toBe(200)
    expect(travellerHeading({ course: null, speed: null, compass: 200 })).toBe(200)
  })

  it('ignores an uncalibrated or vague compass', () => {
    expect(travellerHeading({ course: null, speed: 0, compass: 200, compassAccuracy: -1 })).toBeNull()
    expect(travellerHeading({ course: null, speed: 0, compass: 200, compassAccuracy: 45 })).toBeNull()
    expect(travellerHeading({ course: null, speed: 0, compass: 200, compassAccuracy: 10 })).toBe(200)
  })

  it('knows nothing without a course or compass', () => {
    expect(travellerHeading({ course: null, speed: 3, compass: null })).toBeNull()
    expect(travellerHeading({ course: NaN, speed: 3, compass: null })).toBeNull()
  })
})

describe('startMotion', () => {
  it('rounds the heading and carries the speed', () => {
    expect(startMotion({ course: 359.7, speed: 8.2, compass: null })).toEqual({ heading: 0, speed: 8.2 })
  })

  it('sends nothing it does not know', () => {
    expect(startMotion({ course: null, speed: null, compass: null })).toEqual({})
  })
})
