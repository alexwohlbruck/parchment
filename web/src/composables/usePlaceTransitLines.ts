import { computed, reactive, type Ref } from 'vue'
import type { TransitStopInfo } from '@/types/place.types'
import { orderBullets } from '@/lib/transit-bullets'

type StationRoute = NonNullable<TransitStopInfo['routes']>[number]

/** A line at this station, as the header draws it. */
export type StationLine = StationRoute & {
  /** False when the board shows no run of this line inside its window —
   *  the night-time half of a system, drawn dimmed rather than dropped. */
  inService: boolean
}

/** What the header needs about the board the lines came off. */
export interface StationLinesContext {
  /** Lets a bullet open its route detail; without it a bullet is inert. */
  feedId?: string
  /** Whether service could be judged at all — an empty board is not
   *  evidence that nothing runs. */
  known: boolean
}

/**
 * Bridge between the transit departures widget and the place header.
 *
 * The line bullets for a station (N Q R W S 1 2 3 7…) belong next to the
 * place title, Apple-Maps style — but the data arrives with the transit
 * widget's async fetch, deep in the widget tree. The widget publishes the
 * lines here per place id; the header subscribes.
 *
 * They come out in portolan's bullet order, because the map is usually
 * open beside the panel and the two must agree: Columbus Circle listed
 * 1 2 A B C D here while the map drew A C · B D · 1 2, which is the order
 * the MTA and Apple both use. Sorting on the way OUT rather than the way
 * in means every subscriber gets it, whatever published the lines.
 *
 * Read as two lists, because they answer different questions: the lines the
 * station runs, and the lines a transfer reaches. Only the first belongs
 * beside the title.
 */
type Entry = { routes: StationRoute[]; running: Set<string>; ctx: StationLinesContext }

const byPlace = reactive<Record<string, Entry>>({})

const EMPTY_CTX: StationLinesContext = { known: false }

export function setPlaceTransitLines(
  placeId: string | undefined,
  routes: StationRoute[] | undefined,
  ctx?: { feedId?: string; runningRouteIds?: Iterable<string> },
) {
  if (!placeId || !routes?.length) return
  const running = new Set(ctx?.runningRouteIds ?? [])
  byPlace[placeId] = {
    routes,
    running,
    ctx: {
      feedId: ctx?.feedId,
      // Nothing running at all means the board is empty or absent, and an
      // absent board says nothing about the schedule — dimming every
      // bullet on it would be an assertion we cannot make.
      known: running.size > 0,
    },
  }
}

/** Bullet-order input: the glyphs portolan sorts by are the bullet's own —
 *  short name, long name if there is none. Not parchment's translated mode
 *  fallback ("Tram"), which would sort by the UI language. */
const bulletOf = (r: StationRoute) => ({
  label: r.shortName || r.longName || '',
  color: r.color,
  id: r.id,
})

/**
 * The lines this station runs.
 *
 * Only its own: a line reachable by transfer does not depart from here, and
 * putting it in this row made the header lie twice over. The row dims a bullet
 * whose line has no run on the board — which is honest for a line that stops
 * here and simply isn't running — but a transfer line has no run on this
 * board by construction, so every one of them rendered as "isn't running now"
 * while the trains were in fact turning up one platform away.
 */
export function usePlaceTransitLines(placeId: Ref<string | undefined>) {
  return computed<StationLine[]>(() => {
    const entry = placeId.value ? byPlace[placeId.value] : undefined
    if (!entry) return []
    const own = entry.routes.filter(r => r.via !== 'transfer')
    return orderBullets(own, bulletOf).map(r => ({
      ...r,
      inService: !entry.ctx.known || entry.running.has(r.id),
    }))
  })
}

/**
 * The lines a rider reaches from here without leaving the paid area — the J
 * and Z at Chambers St, from Brooklyn Bridge–City Hall.
 *
 * Never marked out of service. The board that would answer that question is
 * the connecting station's, not this one's, so the honest answer here is to
 * say the transfer exists and stop there.
 */
export function usePlaceTransferLines(placeId: Ref<string | undefined>) {
  return computed<StationLine[]>(() => {
    const entry = placeId.value ? byPlace[placeId.value] : undefined
    return entry ? transferLinesOf(entry.routes) : []
  })
}

/** The same split off a raw route list, for a view holding the board's own
 *  `transitInfo` rather than a place id. */
export function transferLinesOf(routes: StationRoute[] | undefined): StationLine[] {
  const reached = (routes ?? []).filter(r => r.via === 'transfer')
  return orderBullets(reached, bulletOf).map(r => ({ ...r, inService: true }))
}

/** The board's own context — feed and window — for the same place. */
export function usePlaceTransitLinesContext(placeId: Ref<string | undefined>) {
  return computed<StationLinesContext>(
    () => (placeId.value && byPlace[placeId.value]?.ctx) || EMPTY_CTX,
  )
}
