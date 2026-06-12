import { describe, it, expect, vi } from 'vitest'
import { applyDepartureChange, type RebookableSegment } from './trip-rebooking'

const T0 = new Date('2026-06-12T14:00:00Z').getTime()
const min = (n: number) => T0 + n * 60_000

function seg(partial: Partial<RebookableSegment> & { mode: string }): RebookableSegment {
  return {
    startTime: new Date(T0),
    endTime: new Date(min(5)),
    duration: 300,
    ...partial,
  }
}

/** walk(5m move +2m wait) → bus A (14:07→14:20) → walk(3m move +2m wait) → bus B (14:25→14:40) → walk(4m) */
function makeTrip(): RebookableSegment[] {
  return [
    seg({ mode: 'walking', startTime: new Date(T0), endTime: new Date(min(7)), duration: 420, waitSeconds: 120 }),
    seg({ mode: 'transit', startTime: new Date(min(7)), endTime: new Date(min(20)), duration: 780 }),
    seg({ mode: 'walking', startTime: new Date(min(20)), endTime: new Date(min(25)), duration: 300, waitSeconds: 120 }),
    seg({ mode: 'transit', startTime: new Date(min(25)), endTime: new Date(min(40)), duration: 900 }),
    seg({ mode: 'walking', startTime: new Date(min(40)), endTime: new Date(min(44)), duration: 240 }),
  ]
}

const ms = (v: string | Date) => new Date(v).getTime()

describe('applyDepartureChange', () => {
  it('first boarding later: approach shifts rigidly, holding connection keeps its run', async () => {
    const segs = makeTrip()
    const lookup = vi.fn()
    // Take bus A 8 minutes later (14:15). Bus B at 14:25 is still makeable:
    // arrive 14:28?? — bus A arrival becomes 14:28, so B at 14:25 is missed.
    // Use +4 min instead: A departs 14:11, arrives 14:24; walk 3m → 14:27 > 14:25 → B missed too.
    // Use +1 min: A 14:08→14:21, walk 3m → 14:24 ≤ 14:25 → B holds.
    const ok = await applyDepartureChange(segs, 1, min(8), lookup)
    expect(ok).toBe(true)

    // Access walk shifted rigidly, wait preserved
    expect(ms(segs[0].startTime)).toBe(min(1))
    expect(ms(segs[0].endTime)).toBe(min(8))
    expect(segs[0].waitSeconds).toBe(120)

    // Chosen leg on the new run
    expect(ms(segs[1].startTime)).toBe(min(8))
    expect(ms(segs[1].endTime)).toBe(min(21))

    // Transfer walk: 3 min moving from 14:21, stretched to B's 14:25 → 1 min wait
    expect(ms(segs[2].startTime)).toBe(min(21))
    expect(ms(segs[2].endTime)).toBe(min(25))
    expect(segs[2].waitSeconds).toBe(60)

    // B kept its planned run — no lookup needed
    expect(ms(segs[3].startTime)).toBe(min(25))
    expect(lookup).not.toHaveBeenCalled()

    // Egress walk follows B
    expect(ms(segs[4].startTime)).toBe(min(40))
    expect(ms(segs[4].endTime)).toBe(min(44))
  })

  it('missed connection rolls to the next departure via lookup', async () => {
    const segs = makeTrip()
    // Take bus A 10 min later → arrives 14:30; B (14:25) missed → next B at 14:35
    const lookup = vi.fn(async () => min(35))
    await applyDepartureChange(segs, 1, min(17), lookup)

    expect(ms(segs[1].endTime)).toBe(min(30))
    // lookup asked for a run at/after arrival+walk = 14:33
    expect(lookup).toHaveBeenCalledWith(3, min(33))
    // Transfer walk stretches to 14:35, wait = 2 min
    expect(ms(segs[2].endTime)).toBe(min(35))
    expect(segs[2].waitSeconds).toBe(120)
    // B on the 14:35 run, same ride length (15 min)
    expect(ms(segs[3].startTime)).toBe(min(35))
    expect(ms(segs[3].endTime)).toBe(min(50))
    // Egress ends at 14:54
    expect(ms(segs[4].endTime)).toBe(min(54))
  })

  it('mid-trip choice: earlier legs untouched, platform wait absorbed by transfer walk', async () => {
    const segs = makeTrip()
    const lookup = vi.fn()
    // Take bus B at 14:36 instead of 14:25
    await applyDepartureChange(segs, 3, min(36), lookup)

    // Bus A and the access walk untouched
    expect(ms(segs[0].startTime)).toBe(T0)
    expect(ms(segs[1].startTime)).toBe(min(7))
    // Transfer walk absorbs +11 min as wait
    expect(ms(segs[2].endTime)).toBe(min(36))
    expect(segs[2].waitSeconds).toBe(120 + 660)
    // B shifted; egress follows
    expect(ms(segs[3].startTime)).toBe(min(36))
    expect(ms(segs[4].endTime)).toBe(min(55))
  })

  it('no-ops on sub-second deltas', async () => {
    const segs = makeTrip()
    const ok = await applyDepartureChange(segs, 1, min(7), vi.fn())
    expect(ok).toBe(false)
  })
})
