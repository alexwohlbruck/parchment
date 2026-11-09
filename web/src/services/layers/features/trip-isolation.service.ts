/**
 * Trip Isolation Service
 *
 * Decides what the transit network does while an itinerary is on the map,
 * hovered in the list or opened, and puts the itinerary's own stops back
 * on top of it.
 *
 * A trip that rides transit steps the network back, so the trip's own
 * polyline reads as the subject instead of competing with every line it
 * crosses. A trip that rides none takes it off the map altogether: there
 * the ribbons are not context for a walking or driving line, just clutter
 * beside it.
 *
 * The route panel lifts its line out of portolan's ribbons; a trip must
 * not, because portolan draws bundled routes at parallel slot offsets —
 * an isolated A would land beside the trip line rather than under it, the
 * same line drawn twice in two styles. The trip line is already the
 * highlight; the dim is the other half of it.
 *
 * What the dim alone leaves is a coloured stripe across a city. So the
 * SYMBOLS are narrowed the way an isolation narrows them — each leg's own
 * stations, their names, and the bullets riding the span it rides — and
 * kept at full strength over the dimmed ribbons. Where portolan draws the
 * line that is portolan's own lettering; where it does not, portolan draws
 * the leg's own stops in that same lettering (see setDrawnRoutes), exactly
 * as the route panel does for a line no pyramid knows.
 *
 * Stands down entirely when the route panel is the focus: that view owns
 * the dim, and two owners would fight over the paint they restore.
 *
 * Portolan dims its own ribbons rather than being painted over: they mount
 * progressively as tiles hydrate, and a one-shot override catches only the
 * layers that exist the instant it runs. The flat override is left to the
 * retired transitland layers, which are static when they are there at all.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { watch, type WatchStopHandle } from 'vue'
import {
  useTransitFocusStore,
  type TransitNetworkMode,
} from '@/stores/transit-focus.store'
import { useTripFocusStore } from '@/stores/trip-focus.store'
import { usePortolanTransitService } from '@/services/layers/features/portolan/portolan-transit.service'
import type { PortolanTripLeg } from '@/services/layers/features/portolan/portolan-transit.service'
import { stopBulletFor } from '@/services/layers/features/portolan/portolan-bullets'
import {
  fadeTransitNetwork,
  networkDimOpacity,
} from '@/services/layers/features/transit-network-dim'
import {
  addStopOverlay,
  removeStopOverlay,
  stopOverlayIds,
  type StopOverlayIds,
} from '@/services/layers/features/transit-stop-overlay'
import type { FocusedLeg } from '@/lib/transit/transit-focus'

/** Points spread along a leg pin a route token to THIS line's geometry:
 *  several feeds can share a bare id, and one shared terminal cannot tell
 *  them apart (see portolanRouteToken). */
const TOKEN_PROBES = 8

/** Idles to wait for portolan to hydrate before giving up on it, and
 *  idles to keep asking once it has — the tiles a leg runs through arrive
 *  over the fit's ease, so one answer is never the answer. */
const HYDRATION_IDLES = 6
const MISS_IDLES = 3
/** ...and a deadline on both, because idle is not a heartbeat: a map with
 *  nothing left to draw fires it once and stops, so a budget counted only
 *  in idles can wait forever in a city with no pyramid. */
const RECONCILE_DEADLINE_MS = 2500
/** Settling on a fallback is not the last word: a slow pyramid that
 *  answers afterwards still takes its legs back. This many idles after
 *  settling, it stops asking. */
const UPGRADE_IDLES = 20

const overlayIds = (segmentIndex: number): StopOverlayIds =>
  stopOverlayIds(`trip-leg-stops-${segmentIndex}`)

function probesAlong(leg: FocusedLeg): [number, number][] {
  const stops = leg.stops
  if (!stops.length) return []
  const want = Math.min(TOKEN_PROBES, stops.length)
  const step = (stops.length - 1) / Math.max(1, want - 1)
  const out: [number, number][] = []
  for (let i = 0; i < want; i++) {
    const s = stops[Math.round(i * step)]
    if (s) out.push([s.lng, s.lat])
  }
  return out
}

export function useTripIsolationService() {
  const focus = useTransitFocusStore()
  const tripFocus = useTripFocusStore()
  const portolan = usePortolanTransitService()
  let mapInstance: any = null
  let watchStop: WatchStopHandle | null = null
  let legsWatchStop: WatchStopHandle | null = null
  let mode: TransitNetworkMode = 'normal'

  /** Bumps on every leg change, so a deferred answer for an itinerary the
   *  rider has already left does nothing at all. */
  let generation = 0
  let reconciler: Array<[string, (e?: any) => void]> | null = null
  let reconcileDeadline: ReturnType<typeof setTimeout> | null = null
  /** Segment indices whose stops are currently drawn as the overlay. */
  let overlaid = new Set<number>()

  function apply(next: TransitNetworkMode) {
    if (!mapInstance || next === mode) return
    mode = next
    portolan.setNetworkDim(next === 'dimmed')
    portolan.setNetworkHidden(next === 'hidden')
    // The retired transitland layers have no renderer of their own to ask,
    // so they take the flat override — zero opacity is how they hide.
    const opacity =
      next === 'dimmed' ? networkDimOpacity() : next === 'hidden' ? 0 : null
    fadeTransitNetwork(mapInstance, opacity, { skipPortolan: true })
    renderStops()
  }

  /** The legs whose stops this service is responsible for: none at all
   *  unless the trip is what the map is showing. */
  function focusedLegs(): FocusedLeg[] {
    return mode === 'dimmed' ? tripFocus.legs : []
  }

  function clearStops() {
    detachReconciler()
    portolan.setTripLegs(null)
    portolan.setDrawnRoutes(null)
    for (const segmentIndex of overlaid) {
      removeStopOverlay(mapInstance, overlayIds(segmentIndex))
    }
    overlaid = new Set()
  }

  /** The legs no pyramid draws: portolan letters their stops from the
   *  leg's own data when it is up, the plain overlay when it is not. */
  function drawOverlay(legs: FocusedLeg[]) {
    const own = portolan.portolanTransitActive()
    portolan.setDrawnRoutes(
      own
        ? legs
            .filter(leg => leg.stops.length >= 2)
            .map(leg => ({
              color: leg.color,
              // the trip's own polyline is the line
              coordinates: null,
              stops: leg.stops.map(s => ({
                name: s.name,
                lng: s.lng,
                lat: s.lat,
                bullets: [stopBulletFor(legRoute(leg), s)],
              })),
            }))
        : null,
    )
    const next = new Set<number>()
    for (const leg of own ? [] : legs) {
      if (leg.stops.length < 2) continue
      addStopOverlay(
        mapInstance,
        overlayIds(leg.segmentIndex),
        leg.stops.map(s => ({ name: s.name, lng: s.lng, lat: s.lat })),
        leg.color,
      )
      next.add(leg.segmentIndex)
    }
    for (const segmentIndex of overlaid) {
      if (!next.has(segmentIndex)) {
        removeStopOverlay(mapInstance, overlayIds(segmentIndex))
      }
    }
    overlaid = next
  }

  function legRoute(leg: FocusedLeg) {
    return {
      routeId: leg.routeIds[0] ?? '',
      routeShortName: leg.shortName,
      routeLongName: leg.longName,
      routeType: null,
      routeColor: leg.color,
    }
  }

  /** Portolan's token for each of a leg's lines, empty when it draws none
   *  of them. */
  function tokensFor(leg: FocusedLeg): string[] {
    const along = probesAlong(leg)
    return leg.routeIds
      .map(id => portolan.portolanRouteToken(id, along))
      .filter((t): t is string => !!t)
  }

  /**
   * Split the legs between the two renderers and draw.
   *
   * `settled` is whether portolan's answer is final. Until it is, a leg it
   * has not claimed is drawn by NOBODY: the tiles a leg runs through arrive
   * over the fit's ease, so "no token yet" and "no pyramid draws this" look
   * identical, and drawing the overlay in that gap puts plain circles and
   * right-hand labels on screen only to replace them with portolan's
   * bulleted ones a moment later.
   *
   * Returns whether every leg has a renderer.
   */
  function drawLegs(legs: FocusedLeg[], settled: boolean): boolean {
    const drawn: PortolanTripLeg[] = []
    const rest: FocusedLeg[] = []
    for (const leg of legs) {
      const routes = tokensFor(leg)
      if (routes.length) {
        drawn.push({
          routes,
          stops: leg.stops.map(s => [s.lng, s.lat] as [number, number]),
        })
      } else {
        rest.push(leg)
      }
    }
    portolan.setTripLegs(drawn)
    drawOverlay(settled ? rest : [])
    return rest.length === 0
  }

  /** Ask portolan first, and keep asking until its answer is definitive. */
  function renderStops() {
    if (!mapInstance) return
    const legs = focusedLegs()
    generation++
    detachReconciler()
    if (!legs.length) {
      clearStops()
      return
    }

    if (!portolan.isPortolanTransitEnabled()) {
      drawLegs(legs, true)
      return
    }

    const mine = generation
    if (portolan.portolanTransitActive() && drawLegs(legs, false)) return

    let waitsForHydration = 0
    let missesWhileReady = 0
    let settled = false
    let idlesSinceSettled = 0
    /** Fall back for the legs nobody has claimed — and keep listening, so
     *  a pyramid that answers late still takes its legs back. */
    const settle = () => {
      settled = true
      if (drawLegs(legs, true)) detachReconciler()
    }
    const onIdle = () => {
      if (mine !== generation) return detachReconciler()
      if (settled) {
        if (drawLegs(legs, true) || ++idlesSinceSettled >= UPGRADE_IDLES) detachReconciler()
        return
      }
      if (!portolan.portolanTransitActive()) {
        if (++waitsForHydration >= HYDRATION_IDLES) settle()
        return
      }
      if (drawLegs(legs, false)) return detachReconciler()
      // Ready, tiles idle, some leg still unknown: once the fit has landed
      // and the tiles under it have answered a few times, that IS the
      // answer, and the fallback is what the leg gets.
      if (++missesWhileReady >= MISS_IDLES) settle()
    }
    // A portolan tile source finishing is the earliest instant its token can
    // be resolved — idle also waits on the basemap, which is a frame or more
    // later, and that frame is the one the rider sees empty. It only ever
    // ANSWERS: the miss budget is counted on idle alone, or the flood of
    // source events would exhaust it before the route's tiles arrived.
    const onSourceData = (e: any) => {
      if (mine !== generation) return detachReconciler()
      if (!String(e?.sourceId ?? '').startsWith('portolan-tiles-')) return
      if (!e.isSourceLoaded || !portolan.portolanTransitActive()) return
      if (drawLegs(legs, settled)) detachReconciler()
    }
    reconciler = [
      ['idle', onIdle],
      ['sourcedata', onSourceData],
    ]
    for (const [ev, fn] of reconciler) mapInstance.on(ev, fn)

    reconcileDeadline = setTimeout(() => {
      reconcileDeadline = null
      if (mine === generation && !settled) settle()
    }, RECONCILE_DEADLINE_MS)
  }

  function detachReconciler() {
    for (const [ev, fn] of reconciler ?? []) mapInstance?.off(ev, fn)
    reconciler = null
    if (reconcileDeadline) clearTimeout(reconcileDeadline)
    reconcileDeadline = null
  }

  function initialize(map: any) {
    mapInstance = map
    watchStop = watch(() => focus.networkMode, apply, { immediate: true })
    // The legs themselves change without the mode doing: a rebooking, a
    // board naming the run, the rider picking a different itinerary.
    legsWatchStop = watch(
      () =>
        tripFocus.legs
          .map(l => `${l.segmentIndex}:${l.routeIds.join('+')}:${l.stops.length}`)
          .join('|'),
      renderStops,
    )
  }

  function destroy() {
    clearStops()
    apply('normal')
    watchStop?.()
    watchStop = null
    legsWatchStop?.()
    legsWatchStop = null
    mapInstance = null
  }

  return { initialize, destroy }
}
