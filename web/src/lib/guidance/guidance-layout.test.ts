import { describe, expect, it } from 'vitest'
import { isAboard, panelAfterClose, restingFootprint } from './guidance-layout'

describe('restingFootprint', () => {
  const card = { x: 8, y: 600.4, width: 374, height: 220 }

  it('reports a resting card as it is, rounded', () => {
    expect(restingFootprint(card, 0)).toEqual({ x: 8, y: 600, width: 374, height: 220 })
  })

  it('keeps the same rect at every height while expanding', () => {
    const rest = restingFootprint(card, 0)
    for (const extra of [12.3, 80, 160.7]) {
      const open = { ...card, y: card.y - extra, height: card.height + extra }
      expect(restingFootprint(open, extra)).toEqual(rest)
    }
  })

  it('never reports a negative height', () => {
    expect(restingFootprint(card, 999).height).toBe(0)
  })
})

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
