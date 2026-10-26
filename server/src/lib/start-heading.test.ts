import { describe, expect, test } from 'bun:test'
import { holdsStartHeading, startHeading } from './start-heading'

describe('startHeading', () => {
  test('holds a car to the way it faces, moving or not', () => {
    expect(startHeading({ heading: 270 }, 'driving')).toBe(270)
    expect(startHeading({ heading: 270, speed: 12 }, 'driving')).toBe(270)
  })

  test('holds only a cyclist already riding at speed', () => {
    expect(startHeading({ heading: 90, speed: 6 }, 'cycling')).toBe(90)
    expect(startHeading({ heading: 90, speed: 2 }, 'cycling')).toBeUndefined()
    expect(startHeading({ heading: 90 }, 'biking')).toBeUndefined()
  })

  test('never holds a walker', () => {
    expect(startHeading({ heading: 0, speed: 1.5 }, 'walking')).toBeUndefined()
  })

  test('nothing to hold without a heading', () => {
    expect(startHeading(undefined, 'driving')).toBeUndefined()
    expect(startHeading({ speed: 10 }, 'driving')).toBeUndefined()
  })
})

describe('holdsStartHeading', () => {
  test('gates by mode and speed', () => {
    expect(holdsStartHeading('driving', 0)).toBe(true)
    expect(holdsStartHeading('cycling', 4.5)).toBe(true)
    expect(holdsStartHeading('cycling', null)).toBe(false)
    expect(holdsStartHeading('walking', 3)).toBe(false)
    expect(holdsStartHeading('transit', 10)).toBe(false)
  })
})
