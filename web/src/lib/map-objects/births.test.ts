import { describe, expect, test } from 'vitest'
import { Births, GROW_SECONDS, grownAfter, leftAfter } from './births'

const fresh = (born: number) => () => born

describe('births', () => {
  test('a plant standing from one gather to the next keeps its birth', () => {
    const births = new Births()
    births.begin(0)
    expect(births.of(1, fresh(0.2))).toEqual({ born: 0.2, isNew: true })
    births.begin(100)
    expect(births.of(1, fresh(100.2))).toEqual({ born: 0.2, isNew: false })
  })

  test('a plant missing from a couple of gathers, as during a tile swap, is still standing', () => {
    const births = new Births()
    births.begin(0)
    births.of(1, fresh(0))
    births.begin(10)
    births.begin(20)
    births.begin(30)
    expect(births.of(1, fresh(30)).isNew).toBe(false)
  })

  test('a plant missing from a quick run of gathers is still standing', () => {
    const births = new Births()
    births.begin(0)
    births.of(1, fresh(0))
    for (let i = 1; i <= 6; i++) births.begin(i * 0.2)
    expect(births.of(1, fresh(1.2)).isNew).toBe(false)
  })

  test('a plant that left the view and came back grows in again', () => {
    const births = new Births()
    births.begin(0)
    births.of(1, fresh(0))
    for (let i = 1; i <= 4; i++) births.begin(i * 2)
    expect(births.of(1, fresh(8.1))).toEqual({ born: 8.1, isNew: true })
  })

  test('a long pause between gathers does not make standing plants new', () => {
    const births = new Births()
    births.begin(0)
    births.of(1, fresh(0))
    births.begin(600)
    expect(births.of(1, fresh(600)).isNew).toBe(false)
  })

  test('clearing, as when the zoom leaves the range, makes every plant grow in again', () => {
    const births = new Births()
    births.begin(0)
    births.of(1, fresh(0))
    births.clear()
    births.begin(1)
    expect(births.of(1, fresh(1)).isNew).toBe(true)
  })

  test('a plant caught leaving grows back from as much of it as is left', () => {
    const births = new Births()
    births.begin(0)
    births.of(1, fresh(0))
    births.leave(1, 10)
    births.begin(10 + GROW_SECONDS / 2)
    const { born, isNew } = births.of(1, fresh(99))
    expect(isNew).toBe(true)
    expect(grownAfter(10 + GROW_SECONDS / 2 - born)).toBeCloseTo(leftAfter(GROW_SECONDS / 2))
  })

  test('a plant that finished leaving and comes back grows in from nothing', () => {
    const births = new Births()
    births.begin(0)
    births.of(1, fresh(0))
    births.leave(1, 10)
    births.begin(10 + GROW_SECONDS)
    expect(births.of(1, fresh(20))).toEqual({ born: 20, isNew: true })
  })
})
