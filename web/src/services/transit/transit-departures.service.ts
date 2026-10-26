import { api } from '@/lib/api'

export interface LineRun {
  departureStop: { location: { lat: number; lng: number } }
  lineName?: string
  routeOptions?: { shortName?: string }[]
  directionId?: string | number | null
}

/** Next run of this segment's line from its boarding stop at or after `minMs`. */
export async function nextRunAfter(segment: LineRun, minMs: number): Promise<number | null> {
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
    return (
      all
        .filter(
          d =>
            sameLine(d.route?.shortName) &&
            (segment.directionId == null || String(d.directionId) === String(segment.directionId)) &&
            !d.cancelled,
        )
        .map(d => new Date(d.departureTime).getTime())
        .filter(m => m >= minMs)
        .sort((a, b) => a - b)[0] ?? null
    )
  } catch {
    return null
  }
}
