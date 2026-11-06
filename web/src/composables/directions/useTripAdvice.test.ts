import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import en from '@/lib/i18n/en-US.json'
import type { TripOption } from '@/types/directions.types'
import { useDirectionsStore } from '@/stores/directions.store'
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

  it('turns the hint into a short word as the deadline nears', async () => {
    const { advice, wrapper } = mountAdvice([transitTrip(60)])
    expect(advice().transit.badges).toMatchObject([{ text: expect.stringMatching(/^Leave by /) }])
    await vi.advanceTimersByTimeAsync(6 * 60_000)
    expect(advice().transit.badges).toMatchObject([{ text: 'Leave now' }, { text: 'Next +20 min' }])
    wrapper.unmount()
  })

  it('re-plans every minute while calm, every 20 s once a card asks you to act', async () => {
    const { wrapper } = mountAdvice([transitTrip(60)])
    await vi.advanceTimersByTimeAsync(50_000)
    expect(replan).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(replan).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5 * 60_000)
    replan.mockClear()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(replan).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('does not re-plan a search set well ahead', async () => {
    const { wrapper } = mountAdvice([transitTrip(60)])
    useDirectionsStore().departureTime = at(90)
    await vi.advanceTimersByTimeAsync(3 * 60_000)
    expect(replan).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('drops a missed trip and re-plans at once, keeping a list that would be empty', async () => {
    const bike = { id: 'bike', rank: 2, segments: [{ mode: 'biking' }], summary: { totalDuration: 2400 } } as unknown as TripOption
    const { wrapper } = mountAdvice([transitTrip(60), bike])
    const removeTrips = vi.spyOn(useDirectionsStore(), 'removeTrips')
    await vi.advanceTimersByTimeAsync(11 * 60_000)
    expect(removeTrips).toHaveBeenCalledWith(new Set(['transit']))
    expect(replan).toHaveBeenCalled()
    wrapper.unmount()

    const alone = mountAdvice([transitTrip(60)])
    const removeAlone = vi.spyOn(useDirectionsStore(), 'removeTrips')
    await vi.advanceTimersByTimeAsync(11 * 60_000)
    expect(removeAlone).not.toHaveBeenCalled()
    alone.wrapper.unmount()
  })

  it('stops ticking once unmounted', async () => {
    const { wrapper } = mountAdvice([transitTrip(1)])
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(replan).not.toHaveBeenCalled()
  })
})
