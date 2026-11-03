import { describe, expect, test } from 'vitest'
import { boxesCrowd, declutter } from './declutter'

describe('declutter', () => {
  test('earlier points win over later ones crowding them', () => {
    expect(declutter([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 40, y: 0 }, { x: 45, y: 30 }], 30)).toEqual([true, false, true, true])
  })

  test('a dropped point does not crowd out the next', () => {
    expect(declutter([{ x: 0, y: 0 }, { x: 25, y: 0 }, { x: 50, y: 0 }], 30)).toEqual([true, false, true])
  })
})

describe('boxesCrowd', () => {
  const pill = { left: 100, top: 300, right: 200, bottom: 330 }

  test('overlapping boxes crowd', () => {
    expect(boxesCrowd(pill, { left: 150, top: 280, right: 260, bottom: 310 })).toBe(true)
  })

  test('boxes apart only crowd within the margin', () => {
    const above = { left: 120, top: 250, right: 180, bottom: 290 }
    expect(boxesCrowd(pill, above)).toBe(false)
    expect(boxesCrowd(pill, above, 12)).toBe(true)
  })
})
