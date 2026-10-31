import { describe, expect, it } from 'vitest'
import { batteryReport, drainPer20Min, type BatteryReading } from './battery-report'

const reading = (over: Partial<BatteryReading>): BatteryReading => ({
  t: 0,
  level: 0.9,
  charging: false,
  hidden: false,
  navigating: true,
  fixIntervalMs: 1000,
  ...over,
})

describe('drainPer20Min', () => {
  it('scales the drain to twenty minutes', () => {
    expect(drainPer20Min(90, 87, 10 * 60_000)).toBeCloseTo(6)
    expect(drainPer20Min(90, 87, 0)).toBeNull()
  })
})

describe('batteryReport', () => {
  const meta = { saver: 'off', device: 'test' }

  it('reports levels, scaled drain and how the run was spent', () => {
    const report = batteryReport(
      [
        reading({ t: 0, level: 0.9 }),
        reading({ t: 10 * 60_000, level: 0.88, hidden: true, fixIntervalMs: 3000 }),
        reading({ t: 20 * 60_000, level: 0.86, hidden: true, fixIntervalMs: 3000 }),
      ],
      meta,
    )
    expect(report).toContain('20:00')
    expect(report).toContain('Battery 90% → 86% (−4.0%) · 4.0% per 20 min')
    expect(report).toContain('screen hidden 67%')
    expect(report).toContain('Fix interval 1 s 33%, 3 s 67%')
  })

  it('falls back to levels typed in by hand', () => {
    const report = batteryReport(
      [reading({ t: 0, level: null }), reading({ t: 20 * 60_000, level: null })],
      { ...meta, manual: { start: 80, end: 75 } },
    )
    expect(report).toContain('Battery 80% → 75% (−5.0%) · 5.0% per 20 min')
  })

  it('flags a run that charged', () => {
    expect(batteryReport([reading({ charging: true })], meta)).toContain('charging')
  })
})
