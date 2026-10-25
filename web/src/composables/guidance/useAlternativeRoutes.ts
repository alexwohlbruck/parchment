import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import type { Map as MaplibreMap } from 'maplibre-gl'
import { useMapStore } from '@/stores/map.store'
import { useGuidanceStore } from '@/stores/guidance.store'
import { segmentAt } from '@/lib/guidance/nav-route'
import { rerouteOrigin } from '@/lib/guidance/reroute'
import {
  CHECK_INTERVAL_MS,
  chooseOffer,
  overlapShare,
  shouldCheck,
  type Candidate,
  type Offer,
} from '@/lib/guidance/alternatives'
import { canReroute, requestAlternatives, type AlternativeSegment } from '@/services/guidance/reroute.service'
import { AlternativeRouteLayer } from '@/services/guidance/alternative-route-layer'

const OFFER_SECONDS = 10
const DISMISSED_FOR_MS = 10 * 60_000

/** Looks for a better way to finish the segment every couple of minutes, and offers it. */
export function useAlternativeRoutes() {
  const guidance = useGuidanceStore()
  const map = useMapStore().getMapStrategy()?.mapInstance as MaplibreMap | undefined
  const layer = map ? new AlternativeRouteLayer(map) : null

  const offer = shallowRef<(Offer<AlternativeSegment> & { segmentIndex: number }) | null>(null)
  const candidates = shallowRef<Candidate<AlternativeSegment>[]>([])
  const loading = ref(false)
  let dismissedUntil = 0
  let offerTimer: ReturnType<typeof setTimeout> | null = null

  const current = computed(() => {
    const route = guidance.route
    const puck = guidance.progress?.puck
    if (!route || !puck) return null
    const span = segmentAt(route, puck.s)
    const segment = span ? guidance.segments[span.index] : null
    const end = segment?.geometry?.at(-1)
    if (!span || !segment || !end || !canReroute(segment.mode)) return null
    const fraction = span.endDistance > span.startDistance ? (span.endDistance - puck.s) / (span.endDistance - span.startDistance) : 0
    return { route, puck, span, segment, end, remaining: (segment.duration ?? 0) * Math.max(0, fraction) }
  })

  async function fetchCandidates() {
    const here = current.value
    if (!here) return null
    loading.value = true
    try {
      const routes = await requestAlternatives({
        position: rerouteOrigin(here.puck.position, here.puck.bearing, here.puck.speed),
        heading: here.puck.bearing,
        destination: here.end,
        mode: here.segment.mode,
      })
      if (current.value?.span.index !== here.span.index) return null
      candidates.value = routes.map(route => ({
        route,
        metrics: route.metrics,
        overlap: overlapShare(route.geometry, here.route, here.puck.s),
      }))
      return here
    } catch {
      return null
    } finally {
      loading.value = false
    }
  }

  async function check() {
    const here = current.value
    const progress = guidance.progress
    if (!here || !progress || offer.value || Date.now() < dismissedUntil || guidance.status !== 'navigating') return
    const toManeuver = progress.distanceToNext != null && here.puck.speed > 0.5 ? progress.distanceToNext / here.puck.speed : Infinity
    if (!shouldCheck(here.remaining, toManeuver)) return
    const checked = await fetchCandidates()
    if (!checked) return
    const best = chooseOffer(candidates.value, checked.segment.mode, checked.remaining)
    if (!best) return
    offer.value = { ...best, segmentIndex: checked.span.index }
    layer?.show(best.route.geometry)
    offerTimer = setTimeout(dismiss, OFFER_SECONDS * 1000)
  }

  function clearOffer() {
    if (offerTimer) clearTimeout(offerTimer)
    offerTimer = null
    offer.value = null
    layer?.show(null)
  }

  function dismiss() {
    dismissedUntil = Date.now() + DISMISSED_FOR_MS
    clearOffer()
  }

  function take(segmentIndex: number, route: AlternativeSegment) {
    clearOffer()
    guidance.takeAlternative(segmentIndex, route)
  }

  function accept() {
    if (offer.value) take(offer.value.segmentIndex, offer.value.route)
  }

  const interval = setInterval(() => void check(), CHECK_INTERVAL_MS)
  const stop = watch(() => guidance.route, clearOffer)

  onScopeDispose(() => {
    clearInterval(interval)
    stop()
    clearOffer()
    layer?.destroy()
  })

  return { offer, candidates, loading, current, check, accept, dismiss, take, fetchCandidates, preview: (r: AlternativeSegment | null) => layer?.show(r?.geometry ?? null), offerSeconds: OFFER_SECONDS }
}
