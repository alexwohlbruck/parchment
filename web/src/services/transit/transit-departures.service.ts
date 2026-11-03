import { api } from '@/lib/api'
import type { Run } from '@/lib/transit/later-runs'

export interface LineRun {
  departureStop: { location: { lat: number; lng: number } }
  lineName?: string
  routeOptions?: { shortName?: string }[]
  directionId?: string | number | null
}

/** Runs of this segment's line (or an interchangeable one) from its boarding stop at or after `minMs`, soonest first. */
export async function runsAfter(segment: LineRun, minMs: number): Promise<Run[]> {
  try {
    const { data } = await api.get('/transit/departures', {
      params: {
        lat: segment.departureStop.location.lat,
        lng: segment.departureStop.location.lng,
        radius: 50,
        n: 20,
        time: new Date(minMs).toISOString(),
      },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all: any[] = (Array.isArray(data) ? data : []).flatMap(
      (s: { departures?: unknown[] }) => s.departures ?? [],
    )
    const sameLine = (name?: string) =>
      segment.routeOptions?.length
        ? segment.routeOptions.some(o => o.shortName === name)
        : name === segment.lineName
    return all
      .filter(
        d =>
          sameLine(d.route?.shortName) &&
          (segment.directionId == null || String(d.directionId) === String(segment.directionId)) &&
          !d.cancelled,
      )
      .map(d => ({ departureMs: new Date(d.departureTime).getTime(), lineName: d.route?.shortName }))
      .filter(r => r.departureMs >= minMs)
      .sort((a, b) => a.departureMs - b.departureMs)
  } catch {
    return []
  }
}

/** Next run of this segment's line from its boarding stop at or after `minMs`. */
export async function nextRunAfter(segment: LineRun, minMs: number): Promise<number | null> {
  return (await runsAfter(segment, minMs))[0]?.departureMs ?? null
}
