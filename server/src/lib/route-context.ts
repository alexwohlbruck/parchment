import type { OverpassKind, RouteEdgeSegment } from '../types/unified-routing.types'

/** What barrelman's /route says a path passes, by metres along it. */
export interface RouteContext {
  overpasses?: { distance: number; endDistance: number; kind: OverpassKind }[]
  states?: { startDistance: number; endDistance: number; name?: string }[]
  parks?: { startDistance: number; endDistance: number; name?: string }[]
}

/** How far either side of where the route passes beneath it an overpass reaches. */
const OVERPASS_HALF_METERS = 5

interface Stretch {
  startDistance: number
  endDistance: number
  patch: Partial<RouteEdgeSegment>
}

/** Splits segments where a stretch starts or ends inside one, and applies each stretch to the parts it covers. */
export function applyStretches(segments: RouteEdgeSegment[], stretches: Stretch[]): RouteEdgeSegment[] {
  if (!stretches.length) return segments
  return segments.flatMap(segment => {
    const over = stretches.filter(s => s.startDistance < segment.endDistance && s.endDistance > segment.startDistance)
    if (!over.length) return [segment]
    const cuts = new Set([segment.startDistance, segment.endDistance])
    for (const s of over) {
      for (const d of [s.startDistance, s.endDistance]) if (d > segment.startDistance && d < segment.endDistance) cuts.add(d)
    }
    const sorted = [...cuts].sort((a, b) => a - b)
    return sorted.slice(1).map((endDistance, i) => {
      const startDistance = sorted[i]
      const mid = (startDistance + endDistance) / 2
      const patches = over.filter(s => s.startDistance <= mid && mid <= s.endDistance).map(s => s.patch)
      return Object.assign({ ...segment, startDistance, endDistance }, ...patches)
    })
  })
}

/** Folds the overpasses, states and parks of a path onto its edge segments. */
export function foldRouteContext(segments: RouteEdgeSegment[] | undefined, context: RouteContext): RouteEdgeSegment[] | undefined {
  if (!segments) return segments
  const stretches: Stretch[] = [
    ...(context.states ?? []).filter(s => s.name).map(s => ({ ...s, patch: { state: s.name } })),
    ...(context.parks ?? []).map(p => ({ ...p, patch: { inPark: true, ...(p.name && { parkName: p.name }) } })),
    ...(context.overpasses ?? []).map(o => ({
      startDistance: o.distance - OVERPASS_HALF_METERS,
      endDistance: o.endDistance + OVERPASS_HALF_METERS,
      patch: { overpass: o.kind },
    })),
  ]
  return applyStretches(segments, stretches)
}
