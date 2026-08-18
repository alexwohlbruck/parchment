/**
 * Open/closed resolution against a place's own clock.
 *
 * Two failure modes drove this. A span running past midnight — `22:00-02:00` —
 * was compared as two clock strings, so `23:00 >= 22:00 && 23:00 <= 02:00` came
 * out false and a bar that was busy read as closed all night. And the status
 * was computed from the *browser's* clock in one place and the *place's* in
 * another, so the same page could disagree with itself about a place abroad.
 *
 * Time is frozen per test: "open now" is only meaningful against a known now.
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  resolveOpeningStatus,
  isPlaceOpenNow,
  getTimezoneDifference,
  formatRawHours,
} from './place-open.utils'
import type { OpeningHours, OpeningTime } from '@/types/place.types'

function hours(regularHours: OpeningTime[], over: Partial<OpeningHours> = {}): OpeningHours {
  return {
    regularHours,
    isOpen24_7: false,
    isPermanentlyClosed: false,
    isTemporarilyClosed: false,
    ...over,
  }
}

/** Freeze the clock at an exact UTC instant. */
function freeze(iso: string) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(iso))
}

afterEach(() => vi.useRealTimers())

// 2026-08-17 is a Monday.
const MON = 1
const TUE = 2
const SAT = 6
const SUN = 0

describe('overnight spans', () => {
  const bar = hours([{ day: SAT, open: '22:00', close: '02:00' }])

  it('is open before midnight', () => {
    freeze('2026-08-22T23:30:00Z') // Saturday 23:30 UTC
    expect(isPlaceOpenNow(bar, 'UTC')).toBe(true)
  })

  it('is open after midnight, on the following day', () => {
    freeze('2026-08-23T01:00:00Z') // Sunday 01:00 UTC
    expect(isPlaceOpenNow(bar, 'UTC')).toBe(true)
  })

  it('is closed once the span ends', () => {
    freeze('2026-08-23T02:30:00Z') // Sunday 02:30 UTC
    expect(isPlaceOpenNow(bar, 'UTC')).toBe(false)
  })

  it('is closed before it opens', () => {
    freeze('2026-08-22T21:00:00Z') // Saturday 21:00 UTC
    expect(isPlaceOpenNow(bar, 'UTC')).toBe(false)
  })

  it('reports the closing time on the far side of midnight', () => {
    freeze('2026-08-22T23:30:00Z')
    expect(resolveOpeningStatus(bar, 'UTC')?.closesAt).toBe('02:00')
  })
})

describe('ordinary spans', () => {
  const shop = hours([
    { day: MON, open: '09:00', close: '17:00' },
    { day: TUE, open: '09:00', close: '17:00' },
  ])

  it('is open inside the span', () => {
    freeze('2026-08-17T12:00:00Z')
    expect(isPlaceOpenNow(shop, 'UTC')).toBe(true)
  })

  it('is closed before opening, and says when it opens', () => {
    freeze('2026-08-17T08:00:00Z')
    const status = resolveOpeningStatus(shop, 'UTC')

    expect(status?.isOpen).toBe(false)
    expect(status?.opensAt).toBe('09:00')
    expect(status?.opensDay).toBeUndefined() // later today
  })

  it('points at another day once today is over', () => {
    freeze('2026-08-17T18:00:00Z')
    const status = resolveOpeningStatus(shop, 'UTC')

    expect(status?.opensAt).toBe('09:00')
    expect(status?.opensDay).toBe(TUE)
  })

  it('wraps around the end of the week to find the next opening', () => {
    // Sunday evening, with hours only on Monday.
    freeze('2026-08-23T20:00:00Z')
    const status = resolveOpeningStatus(hours([{ day: MON, open: '09:00', close: '17:00' }]), 'UTC')

    expect(status?.opensDay).toBe(MON)
  })

  it('treats a closing time as exclusive', () => {
    freeze('2026-08-17T17:00:00Z')
    expect(isPlaceOpenNow(shop, 'UTC')).toBe(false)
  })
})

describe('the place clock decides, not the browser clock', () => {
  const tokyoShop = hours([{ day: MON, open: '09:00', close: '17:00' }])

  it('is open when it is midday in Tokyo and still Sunday night in New York', () => {
    // 2026-08-17T03:00Z = Monday noon in Tokyo, Sunday 23:00 in New York.
    freeze('2026-08-17T03:00:00Z')

    expect(isPlaceOpenNow(tokyoShop, 'Asia/Tokyo')).toBe(true)
    expect(isPlaceOpenNow(tokyoShop, 'America/New_York')).toBe(false)
  })
})

describe('non-schedule states', () => {
  it.each([
    ['isOpen24_7', { isOpen24_7: true }, true, 'open24_7'],
    ['isPermanentlyClosed', { isPermanentlyClosed: true }, false, 'permanentlyClosed'],
    ['isTemporarilyClosed', { isTemporarilyClosed: true }, false, 'temporarilyClosed'],
  ] as const)('%s short-circuits the schedule', (_label, flag, isOpen, state) => {
    freeze('2026-08-17T12:00:00Z')
    const status = resolveOpeningStatus(hours([], flag), 'UTC')

    expect(status?.state).toBe(state)
    expect(status?.isOpen).toBe(isOpen)
  })

  it('is indeterminate without any hours', () => {
    freeze('2026-08-17T12:00:00Z')
    expect(isPlaceOpenNow(hours([]), 'UTC')).toBeNull()
    expect(isPlaceOpenNow(null, 'UTC')).toBeNull()
  })
})

describe('timezone notice', () => {
  it('is absent when the place shares the device offset', () => {
    freeze('2026-08-17T12:00:00Z')
    // Nothing to tell the reader when the place keeps their own clock.
    const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    expect(getTimezoneDifference(deviceZone)).toBeNull()
  })

  it('is absent for a different zone on the same offset', () => {
    freeze('2026-08-17T12:00:00Z')
    // A notice reading "the same time as you, elsewhere" is pure noise, so the
    // comparison is on offsets rather than zone names.
    expect(getTimezoneDifference('Europe/Lisbon', 'en-US')).toEqual(
      getTimezoneDifference('Europe/London', 'en-US'),
    )
  })

  it('reports the place clock when the offset differs', () => {
    freeze('2026-08-17T03:00:00Z')
    const notice = getTimezoneDifference('Asia/Tokyo', 'en-US')

    expect(notice?.localTime).toBe('12:00 PM')
    expect(notice?.label).toBe('GMT+9')
  })

  it('is absent without a timezone, and survives a bad one', () => {
    freeze('2026-08-17T12:00:00Z')
    expect(getTimezoneDifference(undefined)).toBeNull()
    expect(getTimezoneDifference('Not/AZone')).toBeNull()
  })
})

describe('the raw expression, when nothing can be derived from it', () => {
  it('reads the rules on one line', () => {
    expect(formatRawHours(hours([], { rawText: 'Apr-Oct Mo-Su 09:00-18:00; Nov-Mar 10:00-16:00' })))
      .toBe('Apr-Oct Mo-Su 09:00-18:00 · Nov-Mar 10:00-16:00')
  })

  it('unwraps a value that is nothing but a comment', () => {
    // The quotes are syntax, not something the reader needs to see.
    expect(formatRawHours(hours([], { rawText: '"Temporarily closed"' }))).toBe(
      'Temporarily closed',
    )
  })

  it('is empty when there is no original text to fall back on', () => {
    expect(formatRawHours(hours([]))).toBe('')
    expect(formatRawHours(null)).toBe('')
  })
})
