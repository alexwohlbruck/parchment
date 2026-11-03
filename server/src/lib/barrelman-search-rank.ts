/**
 * Barrelman gives every hit from its codes layer (exact `ref`, `alt_name`,
 * `short_name`) this rank and pins those hits above everything, at any distance.
 */
const CODES_RANK = 0.98

/** Distance at which a hit's score halves; the same curve Barrelman ranks its other text layers with. */
const HALF_SCORE_DISTANCE_M = 50_000

/** Assumed distance of a hit Barrelman returned without one. */
const UNKNOWN_DISTANCE_M = 100_000

/** A code shared by a road and a destination ("JFK") should surface the destination. */
const LINE_CODE_DEMOTION = 0.5

export interface BarrelmanSearchHit {
  text_rank?: number | null
  distance_m?: number | null
  geom_type?: string | null
}

const isCodesHit = (hit: BarrelmanSearchHit) => hit.text_rank === CODES_RANK

export function proximityScore(hit: BarrelmanSearchHit): number {
  const distance = hit.distance_m ?? UNKNOWN_DISTANCE_M
  const demotion = isCodesHit(hit) && hit.geom_type === 'line' ? LINE_CODE_DEMOTION : 1
  return ((hit.text_rank ?? 0) * demotion) / (1 + distance / HALF_SCORE_DISTANCE_M)
}

/**
 * Re-rank Barrelman's codes hits by distance alongside the text matches, so an
 * alt_name 2,000 km away no longer outranks the place of that name nearby. The
 * exact-name localities Barrelman pins ahead of the codes keep their place, and
 * a far code still surfaces when nothing nearer matches.
 */
export function rankCodesByProximity<T extends BarrelmanSearchHit>(hits: T[], limit: number): T[] {
  const lastCode = hits.findLastIndex(isCodesHit)
  if (lastCode < 0 || !hits.some((hit) => hit.distance_m != null)) return hits.slice(0, limit)

  const pinned = hits.slice(0, lastCode).filter((hit) => !isCodesHit(hit))
  const ranked = [...hits.filter(isCodesHit), ...hits.slice(lastCode + 1)]
    .map((hit) => ({ hit, score: proximityScore(hit) }))
    .sort((a, b) => b.score - a.score)
    .map(({ hit }) => hit)

  return [...pinned, ...ranked].slice(0, limit)
}
