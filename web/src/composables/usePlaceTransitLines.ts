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
  /** How far ahead the board looked, so "not running" can say how long. */
  windowMinutes?: number
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
 */
type Entry = { routes: StationRoute[]; running: Set<string>; ctx: StationLinesContext }

const byPlace = reactive<Record<string, Entry>>({})

const EMPTY_CTX: StationLinesContext = { known: false }

export function setPlaceTransitLines(
  placeId: string | undefined,
  routes: StationRoute[] | undefined,
  ctx?: { feedId?: string; windowMinutes?: number; runningRouteIds?: Iterable<string> },
) {
  if (!placeId || !routes?.length) return
  const running = new Set(ctx?.runningRouteIds ?? [])
  byPlace[placeId] = {
    routes,
    running,
    ctx: {
      feedId: ctx?.feedId,
      windowMinutes: ctx?.windowMinutes,
      // Nothing running at all means the board is empty or absent, and an
      // absent board says nothing about the schedule — dimming every
      // bullet on it would be an assertion we cannot make.
      known: running.size > 0,
    },
  }
}

export function usePlaceTransitLines(placeId: Ref<string | undefined>) {
  return computed<StationLine[]>(() => {
    const entry = placeId.value ? byPlace[placeId.value] : undefined
    if (!entry) return []
    const ordered = orderBullets(entry.routes, r => ({
      // the label portolan sorts by is the bullet's own glyphs — short
      // name, long name if there is none. Not parchment's translated
      // mode fallback ("Tram"), which would sort by the UI language.
      label: r.shortName || r.longName || '',
      color: r.color,
      id: r.id,
    }))
    return ordered.map(r => ({
      ...r,
      inService: !entry.ctx.known || entry.running.has(r.id),
    }))
  })
}

/** The board's own context — feed and window — for the same place. */
export function usePlaceTransitLinesContext(placeId: Ref<string | undefined>) {
  return computed<StationLinesContext>(
    () => (placeId.value && byPlace[placeId.value]?.ctx) || EMPTY_CTX,
  )
}
