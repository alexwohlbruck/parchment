import { describe, expect, it } from 'vitest'
import { billboardScale, groundShare } from './lamp-light'

describe('groundShare', () => {
  it('leaves a lamp on the ground its whole pool', () => {
    expect(groundShare(0)).toBe(1)
    expect(groundShare(1)).toBe(1)
  })

  it('throws nothing on the ground from a deck high over it', () => {
    expect(groundShare(4)).toBe(0)
    expect(groundShare(40)).toBe(0)
  })

  it('fades between', () => {
    expect(groundShare(2.5)).toBeCloseTo(0.5)
  })
})

describe('billboardScale', () => {
  it('spans the view a world wide at zoom 0 with a right-angle field of view', () => {
    const [x, y] = billboardScale({ zoom: 0, fov: Math.PI / 2, width: 1000, height: 500 })
    expect(y).toBeCloseTo(512)
    expect(x).toBeCloseTo(256)
  })

  it('doubles with each zoom level', () => {
    const at = (zoom: number) => billboardScale({ zoom, fov: 0.6, width: 800, height: 800 })[1]
    expect(at(15) / at(14)).toBeCloseTo(2)
  })
})
