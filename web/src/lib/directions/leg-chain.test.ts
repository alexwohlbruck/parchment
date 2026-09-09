import { describe, it, expect } from 'vitest'
import { composeLegChain } from './leg-chain'
import type { TripLegOptions, TripOption, TripsResponse } from '@/types/directions.types'

function option(overrides: Partial<TripOption> & { id: string }): TripOption {
  return {
    mode: 'walking',
    summary: {
      totalDuration: 600,
      totalDistance: 800,
      hasTolls: false,
      hasHighways: false,
      hasFerries: false,
    },
    segments: [{ id: `${overrides.id}-s0`, mode: 'walking' }],
    startTime: new Date('2026-01-15T08:00:00Z'),
    endTime: new Date('2026-01-15T08:10:00Z'),
    rank: 1,
    provider: 'multimodal',
    ...overrides,
  } as TripOption
}

const response = { trips: [option({ id: 'original' })] } as unknown as TripsResponse

function legs(...options: TripOption[][]): TripLegOptions[] {
  return options.map((o, legIndex) => ({ legIndex, options: o }))
}

describe('composeLegChain', () => {
  it('runs the chosen option of every leg into one trip', () => {
    const chain = composeLegChain(response, legs(
      [option({ id: 'a' })],
      [option({
        id: 'b',
        startTime: new Date('2026-01-15T08:15:00Z'),
        endTime: new Date('2026-01-15T08:40:00Z'),
      })],
    )).trips[0]

    expect(chain.segments).toHaveLength(2)
    expect(chain.segments.map((s) => (s as any).legIndex)).toEqual([0, 1])
    expect(chain.startTime.toISOString()).toBe('2026-01-15T08:00:00.000Z')
    expect(chain.endTime.toISOString()).toBe('2026-01-15T08:40:00.000Z')
  })

  it('only the leading option of a leg is used', () => {
    const chain = composeLegChain(response, legs(
      [option({ id: 'chosen' }), option({ id: 'ignored' })],
    )).trips[0]

    expect(chain.segments).toHaveLength(1)
    expect(chain.summary.totalDuration).toBe(600)
  })

  it('totals come from the legs, not the segments', () => {
    const chain = composeLegChain(response, legs(
      [option({ id: 'a', co2Emissions: 0.4, cost: { total: { amount: 2.9, currency: 'USD' } } })],
      [option({
        id: 'b',
        summary: { totalDuration: 300, totalDistance: 200 } as TripOption['summary'],
        co2Emissions: 0.1,
        cost: { total: { amount: 1.1, currency: 'USD' } },
      })],
    )).trips[0]

    expect(chain.summary.totalDuration).toBe(900)
    expect(chain.summary.totalDistance).toBe(1000)
    expect(chain.cost!.total).toEqual({ amount: 4, currency: 'USD' })
    expect(chain.co2Emissions).toBeCloseTo(0.5)
  })

  it('a fare in another currency is dropped rather than added up', () => {
    const chain = composeLegChain(response, legs(
      [option({ id: 'a', cost: { total: { amount: 2.9, currency: 'USD' } } })],
      [option({ id: 'b', cost: { total: { amount: 3, currency: 'EUR' } } })],
    )).trips[0]

    expect(chain.cost).toBeUndefined()
  })

  it('a leg with no cost at all leaves the others intact', () => {
    const chain = composeLegChain(response, legs(
      [option({ id: 'a' })],
      [option({ id: 'b', cost: { total: { amount: 2.75, currency: 'USD' } } })],
    )).trips[0]

    expect(chain.cost!.total).toEqual({ amount: 2.75, currency: 'USD' })
    expect(chain.co2Emissions).toBeUndefined()
  })

  it('the legs it was built from ride along on the response', () => {
    const built = legs([option({ id: 'a' })], [option({ id: 'b' })])
    expect(composeLegChain(response, built).legs).toBe(built)
  })
})
