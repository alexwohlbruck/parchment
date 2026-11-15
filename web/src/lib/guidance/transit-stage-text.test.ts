import { describe, expect, it } from 'vitest'
import { stageHeadline } from './transit-stage-text'
import type { TransitStage } from './transit-progress'

const t = (key: string, p?: Record<string, unknown>) => (p ? `${key.split('.').pop()} ${Object.values(p).join()}` : key.split('.').pop()!)

const riding = (over: Partial<Extract<TransitStage, { kind: 'riding' }>> = {}): TransitStage => ({
  segmentIndex: 1,
  kind: 'riding',
  stopsLeft: 4,
  passed: 2,
  nextStop: 'Halsey St',
  alight: 'Tillary St',
  arrivalMs: null,
  remaining: 1200,
  alighting: false,
  ...over,
})

describe('stageHeadline', () => {
  it('counts down to a departure', () => {
    const stage: TransitStage = { segmentIndex: 1, kind: 'wait', stop: 'Halsey St', departureMs: 240_000 }
    expect(stageHeadline(stage, 0, t)).toBe('departsIn 4m')
  })
  it('says departing now in the last half minute', () => {
    const stage: TransitStage = { segmentIndex: 1, kind: 'wait', stop: 'Halsey St', departureMs: 20_000 }
    expect(stageHeadline(stage, 0, t)).toBe('departingNow')
  })
  it('names the stop to get off at', () => expect(stageHeadline(riding(), 0, t)).toBe('getOffAt Tillary St'))
  it('warns one stop out', () => expect(stageHeadline(riding({ stopsLeft: 1 }), 0, t)).toBe('getOffNext'))
  it('says to get off at the stop', () => expect(stageHeadline(riding({ alighting: true }), 0, t)).toBe('getOffNow'))
  it('leaves a missed stop to the full card', () => {
    expect(stageHeadline({ segmentIndex: 1, kind: 'missed-stop', alight: 'Tillary St' }, 0, t)).toBeNull()
  })
})
