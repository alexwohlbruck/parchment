import { describe, expect, test } from 'vitest'
import models from './models.json'
import { DECIDUOUS, MIDSUMMER, PHASE_SPREAD, dayOfYear, phaseOf, plantYear, rampAt, seasonRamps, yearAt } from './seasons'
import { TREE_FAMILIES } from './trees'

const ramps = seasonRamps('light')
const on = (month: number, day = 15) => yearAt(dayOfYear(new Date(2026, month - 1, day)), 40)
const leaf = (role: string, year: number) => rampAt(ramps[role], year).leaf
/** Red over green, for a plant midway along the stand: high in fall colour, low in summer leaf. */
const warmth = (role: string, year: number) => {
  const { color } = rampAt(ramps[role], year, 0.5)
  return color[0] / color[1]
}

describe('the year', () => {
  test('counts days from January 1st', () => {
    expect(dayOfYear(new Date(2026, 0, 1))).toBe(0)
    expect(dayOfYear(new Date(2026, 11, 31))).toBe(364)
  })

  test('runs half a year apart in the south, and stands still in the tropics', () => {
    expect(yearAt(0, -35)).toBeCloseTo(0.5)
    expect(yearAt(0, 10)).toBe(yearAt(200, 10))
  })

  test('each plant runs a few days either side of the date', () => {
    expect(plantYear(0.5, 0)).toBeCloseTo(0.5 - PHASE_SPREAD)
    expect(plantYear(0.5, 1)).toBeCloseTo(0.5 + PHASE_SPREAD)
    const phases = Array.from({ length: 200 }, (_, i) => phaseOf((i * 0.618) % 1, 0.88 + ((i * 0.37) % 0.24)))
    expect(Math.min(...phases)).toBeLessThan(0.1)
    expect(Math.max(...phases)).toBeGreaterThan(0.9)
  })
})

describe('broadleaves', () => {
  test('are bare in winter and in full leaf through summer', () => {
    expect(leaf('foliage', on(1))).toBe(0)
    expect(leaf('foliage', on(7))).toBe(1)
  })

  test('come into and out of leaf gradually', () => {
    const spring = leaf('foliage', on(4, 10))
    const fall = leaf('foliage', on(11, 20))
    expect(spring).toBeGreaterThan(0)
    expect(spring).toBeLessThan(1)
    expect(fall).toBeGreaterThan(0)
    expect(fall).toBeLessThan(1)
  })

  test('spread across greens, yellows, oranges, reds and dusty browns in fall', () => {
    const stand = Array.from({ length: 41 }, (_, i) => rampAt(ramps.foliage, on(10, 25), i / 40).color)
    const some = (test: (c: number[]) => boolean) => stand.filter(test).length
    expect(some(([r, g]) => g > r), 'green').toBeGreaterThan(0)
    expect(some(([r, g, b]) => r > 0.9 && g > 0.75 && b < 0.4), 'yellow').toBeGreaterThan(0)
    expect(some(([r, g, b]) => r > 0.85 && g > 0.4 && g < 0.6 && b < 0.3), 'orange').toBeGreaterThan(0)
    expect(some(([r, g]) => r > 3 * g), 'red').toBeGreaterThan(0)
    expect(some(([r, g, b]) => r > g && g > b && r - b < 0.3), 'dusty brown').toBeGreaterThan(0)
    expect(some(([r, g]) => g > r), 'green holdouts are the few').toBeLessThan(stand.length / 4)
  })

  test('turn warm in fall and keep most of their leaf through mid-November', () => {
    expect(warmth('foliage', on(10, 25))).toBeGreaterThan(1)
    expect(leaf('foliage', on(11, 15))).toBeGreaterThan(0.7)
    expect(warmth('foliage', on(7))).toBeLessThan(1)
  })
})

test('cherries blossom on bare wood before they leaf', () => {
  const { color } = rampAt(ramps.blossom, on(4, 1))
  expect(color[0]).toBeGreaterThan(color[1])
  expect(leaf('blossom', on(4, 1))).toBeGreaterThan(0.5)
  expect(leaf('blossom', on(1))).toBe(0)
})

describe('with seasons off', () => {
  const held = seasonRamps('light', false)

  test('cherries stay in full pink bloom all year, every one of them', () => {
    for (const month of [1, 4, 7, 11])
      for (const tint of [0, 0.5, 1]) {
        const { color: [r, g, b], leaf } = rampAt(held.blossom, on(month), tint)
        expect(leaf).toBe(1)
        expect(r - g, 'pink, not white').toBeGreaterThan(0.2)
        expect(b).toBeGreaterThan(g)
      }
  })

  test('every other plant stays in high summer', () => {
    for (const role of Object.keys(held).filter(role => role !== 'blossom')) {
      const now = rampAt(held[role], on(1))
      const summer = rampAt(ramps[role], MIDSUMMER)
      now.color.forEach((c, i) => expect(c, role).toBeCloseTo(summer.color[i], 2))
      expect(now.leaf, role).toBeCloseTo(summer.leaf, 2)
    }
  })
})

test('evergreens keep their leaf all year', () => {
  for (const month of [1, 4, 7, 10]) {
    expect(leaf('needles', on(month))).toBe(1)
    expect(leaf('shrub', on(month))).toBe(1)
    expect(leaf('frond', on(month))).toBe(1)
  }
})

test('night ramps are darker than day ones', () => {
  const dark = seasonRamps('dark')
  for (const [role, ramp] of Object.entries(ramps)) {
    const sum = (r: typeof ramp) => r.reduce((t, c, i) => (i % 4 === 3 ? t : t + c), 0)
    expect(sum(dark[role]), role).toBeLessThan(sum(ramp))
  }
})

describe('deciduous models', () => {
  test('every bare stand-in was built', () => {
    for (const { bare } of Object.values(DECIDUOUS)) {
      expect(models).toHaveProperty(bare)
      expect(models).toHaveProperty(`${bare}-far`)
    }
  })

  test('cover the broadleaves and cherries, crown-only too, and no evergreen', () => {
    expect(DECIDUOUS).toHaveProperty(TREE_FAMILIES.broadleaf[0])
    expect(DECIDUOUS).toHaveProperty(`${TREE_FAMILIES.blossom[0]}-crown`)
    for (const model of [...TREE_FAMILIES.conifer, ...TREE_FAMILIES.pine, ...TREE_FAMILIES.palm]) expect(DECIDUOUS).not.toHaveProperty(model)
  })
})
