import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import en from '@/lib/i18n/en-US.json'
import type { TripOption } from '@/types/directions.types'
import { useTripListAdvice, type TripCardAdvice } from './useTripAdvice'

const replan = vi.fn()
vi.mock('@/services/directions.service', () => ({
  useDirectionsService: () => ({ replan }),
}))

const BASE = Date.parse('2026-11-04T08:00:00')
const at = (min: number) => new Date(BASE + min * 60_000).toISOString()

function transitTrip(validUntilMin: number): TripOption {
  return {
    id: 'transit',
    rank: 1,
    segments: [{ mode: 'transit', startTime: new Date(at(15)), lineName: 'F', duration: 1500 }],
    summary: { totalDuration: 1800 },
    departureProfile: {
      runs: [
        { leaveBy: at(10), departAt: at(15), arriveAt: at(40), live: true },
        { leaveBy: at(30), departAt: at(35), arriveAt: at(60), live: true },
      ],
      plannedRunIndex: 0,
      validUntil: at(validUntilMin),
    },
  } as unknown as TripOption
}

function mountAdvice(trips: TripOption[]) {
  const list = shallowRef(trips)
  let advice!: { value: Record<string, TripCardAdvice> }
  const Host = defineComponent({
    setup() {
      advice = useTripListAdvice(() => list.value)
      return () => h('div')
    },
  })
  const i18n = createI18n({ legacy: false, locale: 'en-US', messages: { 'en-US': en } })
  const wrapper = mount(Host, { global: { plugins: [createPinia(), i18n] } })
  return { wrapper, list, advice: () => advice.value }
}

describe('useTripListAdvice', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(BASE)
    replan.mockClear()
  })
  afterEach(() => vi.useRealTimers())

  it('recomputes advice as the clock moves, without a fetch', async () => {
    const { advice, wrapper } = mountAdvice([transitTrip(60)])
    expect(advice().transit.line?.text).toMatch(/^Leave by /)
    await vi.advanceTimersByTimeAsync(6 * 60_000)
    expect(advice().transit.line?.text).toBe('Leave now · next is 20 min later')
    expect(replan).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('re-plans once when the profiles run out, and again for a fresh set', async () => {
    const { list, wrapper } = mountAdvice([transitTrip(1)])
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    expect(replan).toHaveBeenCalledTimes(1)

    list.value = [transitTrip(3)]
    await nextTick()
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    expect(replan).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('re-plans a missed run instead of showing it, at most every two minutes', async () => {
    const { advice, list, wrapper } = mountAdvice([transitTrip(60)])
    await vi.advanceTimersByTimeAsync(11 * 60_000)
    expect(advice().transit.line).toBeNull()
    expect(replan).toHaveBeenCalledTimes(1)

    list.value = [transitTrip(60)]
    await nextTick()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(replan).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(replan).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('stops ticking once unmounted', async () => {
    const { wrapper } = mountAdvice([transitTrip(1)])
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(replan).not.toHaveBeenCalled()
  })
})
