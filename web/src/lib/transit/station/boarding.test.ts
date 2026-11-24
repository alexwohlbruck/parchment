import { describe, expect, test } from 'vitest'
import { boardingTarget, waitMinutes, waitWalkSeconds } from './boarding'

describe('boardingTarget', () => {
  test('names an exit by its corner, without the compass side', () => {
    expect(boardingTarget({ toward: 'exit', landmark: 'Canal St & 6 Av · NW corner' })).toEqual({ kind: 'exit', name: 'Canal St & 6 Av' })
  })

  test('names a transfer by its line, without the direction', () => {
    expect(boardingTarget({ toward: 'transfer', landmark: 'the 7 · Queens' })).toEqual({ kind: 'transfer', name: '7' })
  })

  test('has nothing to name without a landmark', () => {
    expect(boardingTarget({ toward: 'exit', landmark: null })).toBeNull()
  })
})

describe('waitWalkSeconds', () => {
  const now = 1_000_000
  const at = (seconds: number) => now + seconds * 1000

  test('suggests the walk when the wait comfortably covers it', () => {
    expect(waitWalkSeconds({ platformWalkSeconds: 70 }, at(240), now)).toBe(240)
  })

  test('stays quiet when the train is due before the walk and a margin', () => {
    expect(waitWalkSeconds({ platformWalkSeconds: 70 }, at(120), now)).toBeNull()
  })

  test('stays quiet for a few steps, or when the walk is unknown', () => {
    expect(waitWalkSeconds({ platformWalkSeconds: 10 }, at(600), now)).toBeNull()
    expect(waitWalkSeconds({ platformWalkSeconds: null }, at(600), now)).toBeNull()
    expect(waitWalkSeconds({}, at(600), now)).toBeNull()
  })
})

describe('waitMinutes', () => {
  test('rounds down, so "4 min" is never more than is left', () => {
    expect(waitMinutes(299)).toBe(4)
    expect(waitMinutes(30)).toBe(1)
  })
})
