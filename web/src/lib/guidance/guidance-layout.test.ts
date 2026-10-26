import { describe, expect, it } from 'vitest'
import { isAboard, panelAfterClose } from './guidance-layout'

describe('panelAfterClose', () => {
  it('returns to the menu from a panel opened there', () => {
    expect(panelAfterClose('steps', 'menu', 'menu')).toBe('menu')
  })

  it('closes a panel opened straight from the map', () => {
    expect(panelAfterClose('search', null, 'menu')).toBeNull()
  })

  it('closes the menu itself', () => {
    expect(panelAfterClose('menu', 'menu', 'menu')).toBeNull()
  })
})

describe('isAboard', () => {
  const base = { segmentIndex: 1, stop: 'Atlantic Av', departureMs: 0 }

  it('is false walking to the stop and with no transit at all', () => {
    expect(isAboard(null)).toBe(false)
    expect(isAboard({ ...base, kind: 'to-stop' } as never)).toBe(false)
  })

  it('is true waiting for and missing a vehicle', () => {
    expect(isAboard({ ...base, kind: 'wait' } as never)).toBe(true)
    expect(isAboard({ ...base, kind: 'missed-vehicle' } as never)).toBe(true)
  })
})
