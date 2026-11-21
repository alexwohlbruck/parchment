import { describe, expect, test } from 'vitest'
import { baseGroundColor, groundColor } from './seasonal-ground'

const parse = (hsl: string) => (hsl.match(/-?[\d.]+/g) ?? []).map(Number)
const day = (d: number) => d / 365

describe('groundColor', () => {
  test('is the style’s own green in high summer', () => {
    const [h, s, l] = parse(groundColor('Grass', 'light', day(185)))
    expect([h, s, l]).toEqual(parse(baseGroundColor('Grass', 'light')))
  })

  test('turns a lawn to straw in winter: warmer, duller, paler', () => {
    const [h0, s0, l0] = parse(baseGroundColor('Grass', 'light'))
    const [h, s, l] = parse(groundColor('Grass', 'light', day(20)))
    expect(h).toBeLessThan(h0 - 30)
    expect(s).toBeLessThan(s0)
    expect(l).toBeGreaterThan(l0)
  })

  test('freshens a lawn in spring', () => {
    const [, s0] = parse(baseGroundColor('Grass', 'light'))
    expect(parse(groundColor('Grass', 'light', day(120)))[1]).toBeGreaterThan(s0)
  })

  test('turns woods rust in fall', () => {
    expect(parse(groundColor('Wood', 'light', day(290)))[0]).toBeLessThan(70)
  })

  test('moves smoothly from day to day', () => {
    for (let d = 0; d < 365; d++) {
      const [a] = parse(groundColor('Grass', 'light', day(d)))
      const [b] = parse(groundColor('Grass', 'light', day(d + 1)))
      expect(Math.abs(a - b), `day ${d}`).toBeLessThan(4)
    }
  })

  test('keeps night fills dark', () => {
    for (const d of [20, 120, 185, 290]) expect(parse(groundColor('Grass', 'dark', day(d)))[2]).toBeLessThan(30)
  })
})
