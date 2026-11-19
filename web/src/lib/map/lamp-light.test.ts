import { describe, expect, it } from 'vitest'
import { groundShare } from './lamp-light'

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
