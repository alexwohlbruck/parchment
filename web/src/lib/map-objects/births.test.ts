import { describe, expect, test } from 'vitest'
import { Births } from './births'

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
})
