import { describe, expect, it } from 'vitest'
import type { TransitTransfer } from '@server/types/station-guidance.types'
import { transferSummary } from './transfer'

const transfer = (over: Partial<TransitTransfer>): TransitTransfer => ({
  class: 'in_station', surfaces: false, reentryFree: null, fareGateDelayS: 0,
  seconds: 82, source: 'graph', walk: null, ...over,
})

describe('transferSummary', () => {
  it('times an in-station change walked on the station map', () => {
    expect(transferSummary(transfer({}))).toEqual({
      kind: 'inStation', seconds: 82, estimate: false, viaStreet: false, reentryFree: null,
    })
  })

  it('gives a cross-platform change no walk time', () => {
    expect(transferSummary(transfer({ class: 'same_platform', seconds: 15 })).seconds).toBeNull()
  })

  it('marks a guessed time as an estimate', () => {
    expect(transferSummary(transfer({ class: 'in_system_passage', source: 'estimated', surfaces: null })))
      .toMatchObject({ kind: 'passageway', estimate: true, viaStreet: false })
    expect(transferSummary(transfer({ source: 'agency' })).estimate).toBe(false)
  })

  it('says whether re-entering after tapping out is free', () => {
    expect(transferSummary(transfer({ class: 'out_of_system', surfaces: true, reentryFree: false, fareGateDelayS: 20 })))
      .toMatchObject({ kind: 'reenter', viaStreet: true, reentryFree: false })
  })
})
