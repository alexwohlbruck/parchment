import { describe, expect, test } from 'vitest'
import { classifyRecovery, ridesSameLines, type MissedRide, type RecoverySegment } from './missed-recovery'

const NOW = Date.parse('2026-11-02T09:00:00Z')
const at = (min: number) => new Date(NOW + min * 60_000)
const line = [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }]
const walk = (end: number): RecoverySegment => ({ mode: 'walking', endTime: at(end), geometry: line })
const ride = (name: string, from: string, to: string, start: number, end: number): RecoverySegment => ({
  mode: 'transit',
  lineName: name,
  tripId: `${name}@${start}`,
  departureStop: { name: from },
  arrivalStop: { name: to },
  startTime: at(start),
  endTime: at(end),
  geometry: line,
})
const plan = (...segments: RecoverySegment[]) => ({ segments, endTime: segments.at(-1)!.endTime! })

// The 4 from Bergen St left at 9:00; the plan arrived at 9:30.
const missed: MissedRide = {
  remaining: [ride('4', 'Bergen St', 'Wall St', -1, 25), walk(30)],
  missedMs: at(-1).getTime(),
  plannedEndMs: at(30).getTime(),
}
const nextFour = (start: number) => plan(walk(1), ride('4', 'Bergen St', 'Wall St', start, start + 26), walk(start + 31))
const two = (start: number, end: number) => plan(walk(3), ride('2', 'Borough Hall', 'Wall St', start, end - 4), walk(end))

describe('ridesSameLines', () => {
  test('matches the same lines between the same stops, whatever the run', () => {
    expect(ridesSameLines(missed.remaining, nextFour(6).segments)).toBe(true)
  })

  test('tells a different line or a different stop apart', () => {
    expect(ridesSameLines(missed.remaining, two(4, 30).segments)).toBe(false)
    expect(ridesSameLines(missed.remaining, plan(ride('4', 'Atlantic Av', 'Wall St', 6, 30)).segments)).toBe(false)
  })

  test('wants every ride to line up, not just the first', () => {
    const transfer = plan(ride('4', 'Bergen St', 'Wall St', 6, 30), ride('J', 'Broad St', 'Canal St', 34, 40))
    expect(ridesSameLines(missed.remaining, transfer.segments)).toBe(false)
  })

  test('takes a line the plan named as interchangeable', () => {
    const either = [{ ...missed.remaining[0], routeOptions: [{ shortName: '4' }, { shortName: '5' }] }]
    expect(ridesSameLines(either, plan(ride('5', 'Bergen St', 'Wall St', 6, 30)).segments)).toBe(true)
  })

  test('prefers stop ids over names when both have them', () => {
    const planned = [{ ...missed.remaining[0], departureStop: { id: 'a', name: 'Bergen St' } }]
    const renamed = { ...nextFour(6).segments[1], departureStop: { id: 'a', name: 'Bergen Street' } }
    expect(ridesSameLines(planned, [renamed])).toBe(true)
  })
})

describe('classifyRecovery', () => {
  test('retimes onto the next run when nothing is clearly sooner', () => {
    const recovery = classifyRecovery(missed, [nextFour(6), two(4, 36)], NOW)
    expect(recovery?.kind).toBe('retime')
    if (recovery?.kind !== 'retime') return
    expect(recovery.next.departureMs).toBe(at(6).getTime())
    expect(recovery.next.delayMs).toBe(7 * 60_000)
  })

  test('recommends another plan arriving clearly sooner, keeping the next run as the fallback', () => {
    const recovery = classifyRecovery(missed, [nextFour(6), two(2, 31)], NOW)
    expect(recovery?.kind).toBe('recommend-switch')
    if (recovery?.kind !== 'recommend-switch') return
    expect(recovery.better.arrivalMs).toBe(at(31).getTime())
    expect(recovery.next.arrivalMs).toBe(at(37).getTime())
  })

  test('lists the options when the next run is far behind them', () => {
    const recovery = classifyRecovery(missed, [nextFour(30), two(2, 31), two(10, 40)], NOW)
    expect(recovery?.kind).toBe('choose')
    if (recovery?.kind !== 'choose') return
    expect(recovery.options.map(o => o.arrivalMs)).toEqual([at(31), at(40), at(61)].map(d => d.getTime()))
  })

  test('lists the options when the line has no later run', () => {
    const recovery = classifyRecovery(missed, [two(10, 40), two(2, 31)], NOW)
    expect(recovery).toEqual({ kind: 'choose', options: [expect.objectContaining({ arrivalMs: at(31).getTime() }), expect.anything()] })
  })

  test('does not count the missed run itself as the next one', () => {
    const planned = plan(walk(0), ride('4', 'Bergen St', 'Wall St', -1, 25), walk(30))
    expect(classifyRecovery(missed, [planned], at(-2).getTime())).toBeNull()
  })

  test('drops plans whose first ride has already left', () => {
    expect(classifyRecovery(missed, [nextFour(6)], at(7).getTime())).toBeNull()
  })

  test('skips plans guidance cannot follow', () => {
    const shapeless = plan(walk(1), { ...ride('4', 'Bergen St', 'Wall St', 6, 32), geometry: [] })
    expect(classifyRecovery(missed, [shapeless], NOW)).toBeNull()
  })

  test('is nothing at all with no candidates', () => {
    expect(classifyRecovery(missed, [], NOW)).toBeNull()
  })
})
