import { onScopeDispose, shallowRef, watch } from 'vue'
import { useGuidanceStore } from '@/stores/guidance.store'
import { segmentAt } from '@/lib/guidance/nav-route'
import { chooseItinerary, isTransitOnly, ITINERARY_CHECK_MS, type ItineraryOffer } from '@/lib/guidance/better-itinerary'
import { requestTransitItineraries } from '@/services/guidance/reroute.service'
import { guidanceClock } from '@/services/guidance/guidance-clock'
import type { TripOption } from '@/types/directions.types'

const OFFER_SECONDS = 12
const DISMISSED_FOR_MS = 10 * 60_000
/** On board, or with its own recovery card up. */
const BUSY_STAGES = new Set(['riding', 'missed-stop', 'missed-vehicle'])

type Segments = Parameters<ReturnType<typeof useGuidanceStore>['takeItinerary']>[1]

/** Replans the transit trip from where the rider is every couple of minutes while off board, and offers a clearly earlier one. */
export function useBetterItinerary() {
  const guidance = useGuidanceStore()
  const offer = shallowRef<(ItineraryOffer<TripOption> & { from: number }) | null>(null)
  let dismissedUntil = 0
  let offerTimer: ReturnType<typeof setTimeout> | null = null
  let checking = false

  async function check() {
    const route = guidance.route
    const puck = guidance.progress?.puck
    const end = guidance.segments.at(-1)?.geometry?.at(-1)
    if (!route || !puck || !end || checking || offer.value || guidance.status !== 'navigating') return
    if (Date.now() < dismissedUntil || BUSY_STAGES.has(guidance.transit?.kind ?? '')) return
    const from = segmentAt(route, puck.s)?.index ?? 0
    const remaining = guidance.segments.slice(from)
    if (!isTransitOnly(remaining)) return
    checking = true
    try {
      const now = guidanceClock.now()
      const candidates = await requestTransitItineraries({ position: puck.position, destination: end, departAt: new Date(now) })
      if (guidance.route !== route) return
      const best = chooseItinerary(remaining, candidates, now)
      if (!best) return
      offer.value = { ...best, from }
      offerTimer = setTimeout(dismiss, OFFER_SECONDS * 1000)
    } catch {
      // The plan being followed still stands; the next check retries.
    } finally {
      checking = false
    }
  }

  function clearOffer() {
    if (offerTimer) clearTimeout(offerTimer)
    offerTimer = null
    offer.value = null
  }

  function dismiss() {
    dismissedUntil = Date.now() + DISMISSED_FOR_MS
    clearOffer()
  }

  function accept() {
    const taken = offer.value
    if (!taken) return
    clearOffer()
    guidance.takeItinerary(taken.from, taken.itinerary.segments as Segments)
  }

  const interval = setInterval(() => void check(), ITINERARY_CHECK_MS)
  const stop = watch(() => guidance.route, clearOffer)

  onScopeDispose(() => {
    clearInterval(interval)
    stop()
    clearOffer()
  })

  return { offer, check, accept, dismiss, offerSeconds: OFFER_SECONDS }
}
