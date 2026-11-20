import { describe, expect, test } from 'vitest'
import models from './models.json'
import { seasonAt, seasonSwaps } from './seasons'
import { TREE_FAMILIES } from './trees'

const day = (month: number) => new Date(2026, month - 1, 15)

describe('seasonAt', () => {
  test('follows the month in the north', () => {
    expect(seasonAt(day(1), 40)).toBe('winter')
    expect(seasonAt(day(4), 40)).toBe('spring')
    expect(seasonAt(day(7), 40)).toBe('summer')
    expect(seasonAt(day(10), 40)).toBe('fall')
    expect(seasonAt(day(12), 40)).toBe('winter')
  })

  test('runs half a year apart in the south', () => {
    expect(seasonAt(day(1), -35)).toBe('summer')
    expect(seasonAt(day(4), -35)).toBe('fall')
    expect(seasonAt(day(7), -35)).toBe('winter')
    expect(seasonAt(day(10), -35)).toBe('spring')
  })

  test('keeps the tropics in leaf', () => {
    for (const month of [1, 4, 7, 10]) expect(seasonAt(day(month), 10)).toBe('summer')
  })
})

describe('seasonSwaps', () => {
  test('only winter swaps models', () => {
    for (const season of ['spring', 'summer', 'fall'] as const) expect(seasonSwaps(season)).toEqual({})
  })

  test('every winter stand-in was built', () => {
    for (const bare of Object.values(seasonSwaps('winter'))) {
      expect(models).toHaveProperty(bare)
      expect(models).toHaveProperty(`${bare}-far`)
    }
  })

  test('evergreens keep their leaves', () => {
    const swapped = seasonSwaps('winter')
    for (const model of [...TREE_FAMILIES.conifer, ...TREE_FAMILIES.pine, ...TREE_FAMILIES.palm]) expect(swapped).not.toHaveProperty(model)
    expect(swapped).toHaveProperty(TREE_FAMILIES.broadleaf[0])
    expect(swapped).toHaveProperty(`${TREE_FAMILIES.blossom[0]}-crown`)
  })
})
