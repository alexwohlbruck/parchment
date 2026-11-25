import { describe, expect, it } from 'vitest'
import { tileWorkerCount } from './tile-workers'

describe('tileWorkerCount', () => {
  it('uses half the cores', () => {
    expect(tileWorkerCount(6)).toBe(3)
  })

  it('keeps at least two workers on small or unknown devices', () => {
    expect(tileWorkerCount(2)).toBe(2)
    expect(tileWorkerCount(undefined)).toBe(2)
  })

  it('caps at four so workers do not crowd out the main and GPU threads', () => {
    expect(tileWorkerCount(14)).toBe(4)
  })
})
