import type { RouteEdgeSegment, RouteInstruction } from '../types/unified-routing.types'

/** Less of a street than this along a step does not name it. */
const MIN_NAMED_METERS = 5

/** The street with the most of `[from, to]` along it, from the sidewalk names on the edges. */
export function streetAlong(edges: RouteEdgeSegment[], from: number, to: number): Pick<RouteEdgeSegment, 'streetName' | 'streetNameSource'> | null {
  const metres = new Map<string, { length: number; edge: RouteEdgeSegment }>()
  for (const edge of edges) {
    if (!edge.streetName) continue
    const overlap = Math.min(to, edge.endDistance) - Math.max(from, edge.startDistance)
    if (overlap <= 0) continue
    const seen = metres.get(edge.streetName)
    metres.set(edge.streetName, { length: (seen?.length ?? 0) + overlap, edge: seen?.edge ?? edge })
  }
  const best = [...metres.values()].sort((a, b) => b.length - a.length)[0]
  if (!best || best.length < MIN_NAMED_METERS) return null
  return { streetName: best.edge.streetName, streetNameSource: best.edge.streetNameSource }
}

/**
 * Names the steps that follow an unnamed sidewalk after the street it runs
 * beside, and words their text to match with `onto`.
 */
export function nameSidewalkSteps(
  instructions: RouteInstruction[],
  edges: RouteEdgeSegment[] | undefined,
  onto: (action: string, road: string) => string,
): RouteInstruction[] {
  if (!edges?.some(e => e.streetName)) return instructions
  let start = 0
  return instructions.map(instruction => {
    const from = start
    start += instruction.distance
    if (instruction.streetName || instruction.streetRef || instruction.type === 'destination') return instruction
    const street = streetAlong(edges, from, from + instruction.distance)
    if (!street?.streetName) return instruction
    return {
      ...instruction,
      ...street,
      text: instruction.text ? onto(instruction.text, street.streetName) : street.streetName,
    }
  })
}
