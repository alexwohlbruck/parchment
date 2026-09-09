import { describe, test, expect } from 'vitest'
import {
  depCountdown,
  entrancePhrase,
  formatCo2,
  joinStatus,
  modeColor,
  movingDuration,
  railColorAt,
  railStyleAt,
  segmentRail,
  waitMinutes,
} from '@/lib/directions/trip-display'

const NOW = new Date('2026-01-01T12:00:00Z').getTime()
const min = (n: number) => NOW + n * 60_000

describe('depCountdown', () => {
  test('reads "now" only at the rounded minute, never once departed', () => {
    expect(depCountdown(NOW, NOW).lead).toBe('now')
    // 20s out still rounds to 0 minutes, so it is "now"
    expect(depCountdown(NOW + 20_000, NOW).lead).toBe('now')
    // 20s gone is negative, so it must not read "now"
    expect(depCountdown(NOW - 20_000, NOW).lead).toBe('1m ago')
  })

  test('counts minutes up to the hour', () => {
    expect(depCountdown(min(1), NOW).lead).toBe('1 min')
    expect(depCountdown(min(59), NOW).lead).toBe('59 min')
  })

  test('switches to hours past sixty minutes', () => {
    expect(depCountdown(min(60), NOW).lead).toBe('1h')
    expect(depCountdown(min(95), NOW).lead).toBe('1h 35m')
  })

  test('gives up on minutes an hour after departure', () => {
    expect(depCountdown(min(-30), NOW).lead).toBe('30m ago')
    expect(depCountdown(min(-90), NOW).lead).toBe('departed')
  })
})

describe('waitMinutes', () => {
  test('treats a sub-minute wait as timetable noise', () => {
    expect(waitMinutes({ waitSeconds: 59 })).toBe(0)
    expect(waitMinutes({})).toBe(0)
  })

  test('rounds a real wait to minutes', () => {
    expect(waitMinutes({ waitSeconds: 60 })).toBe(1)
    expect(waitMinutes({ waitSeconds: 100 })).toBe(2)
  })
})

describe('movingDuration', () => {
  test('subtracts waiting from the leg duration', () => {
    expect(movingDuration({ duration: 600, waitSeconds: 120 })).toBe(480)
  })

  test('never reports negative movement', () => {
    expect(movingDuration({ duration: 60, waitSeconds: 600 })).toBe(0)
  })
})

describe('entrancePhrase', () => {
  test('prefers a real entrance name', () => {
    expect(entrancePhrase({ role: 'entrance', name: 'Main St' })).toBe('Enter at Main St')
    expect(entrancePhrase({ role: 'exit', name: 'Main St' })).toBe('Exit at Main St')
  })

  test('uses a platform description only when entering', () => {
    expect(entrancePhrase({ description: '1 trains Downtown' })).toBe('Enter · 1 trains Downtown')
    expect(entrancePhrase({ role: 'exit', description: '1 trains Downtown' })).toBe('')
  })

  test('says nothing rather than fabricating', () => {
    expect(entrancePhrase(null)).toBe('')
    expect(entrancePhrase({})).toBe('')
  })
})

describe('formatCo2', () => {
  test('uses grams below a kilogram', () => {
    expect(formatCo2(0.42)).toBe('420 g')
  })

  test('uses one decimal kilogram above', () => {
    expect(formatCo2(1.25)).toBe('1.3 kg')
  })
})

describe('joinStatus', () => {
  test('appends only when there is something to append', () => {
    expect(joinStatus('On time', 'crowded')).toBe('On time — crowded')
    expect(joinStatus('On time', null)).toBe('On time')
  })
})

describe('rail paint', () => {
  const entries = [
    { kind: 'waypoint' },
    { kind: 'segment', segment: { mode: 'walking', lineColor: null } },
    { kind: 'stop' },
    { kind: 'segment', segment: { mode: 'transit', lineColor: 'EE352E' } },
    { kind: 'waypoint' },
  ]

  test('takes colour from the nearest segment in that direction', () => {
    expect(railColorAt(entries, 2, 'above')).toBe(modeColor('walking'))
    expect(railColorAt(entries, 2, 'below')).toBe(modeColor('transit'))
  })

  test('falls back to the border colour past the ends', () => {
    expect(railColorAt(entries, 0, 'above')).toBe('bg-border')
    expect(railColorAt(entries, 4, 'below')).toBe('bg-border')
  })

  test('prefers a line colour over the mode class', () => {
    expect(railStyleAt(entries, 2, 'below')).toEqual({ background: '#EE352E' })
    expect(railStyleAt(entries, 2, 'above')).toEqual({})
  })

  test('paints a transit card rail with the line colour', () => {
    expect(segmentRail({ mode: 'transit', lineColor: 'EE352E' }))
      .toEqual({ style: { background: '#EE352E' } })
    expect(segmentRail({ mode: 'walking' })).toEqual({ class: modeColor('walking') })
  })

  test('falls back for an unknown mode', () => {
    expect(modeColor('teleport')).toBe('bg-parchment-500')
  })
})
