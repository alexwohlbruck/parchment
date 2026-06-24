/**
 * Stable identity for a planned trip, independent of the planning session.
 *
 * Trip ids are minted per plan (`trip-<timestamp>-<idx>`), so they can't
 * survive a refresh or travel between devices. The signature captures what
 * makes a trip "the same way to go" — the ordered sequence of meaningful
 * legs — so a trip URL can carry it and a fresh re-plan with the same
 * inputs can find the matching option again.
 *
 * Same-signature trips are the same routing with different departures; the
 * URL's `depart` parameter anchors the re-plan so the times line up too.
 */

interface SignatureSegment {
  mode: string
  lineName?: string
  ownership?: string
  sharedMobilityDetails?: { vehicleType?: string } | null
}

export function tripSignature(segments: SignatureSegment[] | undefined): string {
  if (!segments?.length) return ''
  const tokens: string[] = []
  for (const seg of segments) {
    if (seg.mode === 'transit') {
      tokens.push((seg.lineName || 'transit').toLowerCase())
    } else if (seg.ownership === 'shared' || seg.sharedMobilityDetails) {
      tokens.push(`share-${seg.sharedMobilityDetails?.vehicleType || 'bike'}`)
    } else if (seg.mode === 'driving') {
      tokens.push('drive')
    } else if (seg.mode === 'cycling' || seg.mode === 'biking') {
      tokens.push('bike')
    } else if (seg.mode === 'wheelchair') {
      tokens.push('wheel')
    }
    // walking legs are connective tissue — every trip has them
  }
  return tokens.length ? tokens.join('>') : 'walk'
}
