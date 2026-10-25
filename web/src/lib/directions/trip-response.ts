// The planner's scored candidates as the trips the UI shows.

function normalizeMode(mode: string): string {
  const map: Record<string, string> = {
    biking: 'cycling',
    walking: 'walking',
    driving: 'driving',
    transit: 'transit',
  }
  return map[mode] || mode
}

/**
 * Extract transit-specific fields from a segment's transitDetails.
 * Returns an object with lineName, lineColor, headsign, etc. —
 * or empty object if not a transit segment.
 */
function extractTransitFields(seg: any) {
  const td = seg.details?.transitDetails
  if (!td) return {}
  return {
    lineName: td.shortName || td.route?.shortName || td.route?.longName,
    lineColor: td.color || td.route?.color,
    lineTextColor: td.textColor || td.route?.textColor,
    lineLongName: td.route?.longName,
    headsign: td.headsign || td.trip?.headsign,
    tripShortName: td.trip?.shortName,
    // Interchangeable routes on shared track (e.g. the 4 and the 5). Present
    // (length > 1) on merged legs — render "4 or 5" and union the board.
    routeOptions: (td.routeOptions ?? []).map((r: any) => ({
      shortName: r.shortName,
      color: r.color,
      textColor: r.textColor,
    })),
    directionId: td.directionId,
    agencyName: td.route?.agency?.name,
    agencyId: td.route?.agency?.id,
    routeType: td.route?.type,
    tripId: td.trip?.id,
    departureStop: td.departureStop,
    arrivalStop: td.arrivalStop,
    intermediateStops: td.stops?.slice(1, -1), // exclude first/last
    realTimeData: td.realTimeData,
    delay: td.delay,
    transitDetails: td,
  }
}

/**
 * Map a single raw backend segment to the flattened UI format.
 */
function mapSegment(seg: any, id: string, legIndex: number) {
  return {
    id,
    type: 'route',
    legIndex,
    mode: normalizeMode(seg.mode),
    vehicleType: seg.vehicle?.type || seg.mode,
    startTime: new Date(seg.startTime),
    endTime: new Date(seg.endTime),
    duration: seg.duration,
    distance: seg.distance,
    waitSeconds: seg.waitSeconds,
    geometry: seg.geometry,
    instructions: seg.instructions,
    totalElevationGain: seg.totalElevationGain,
    totalElevationLoss: seg.totalElevationLoss,
    maxElevation: seg.maxElevation,
    minElevation: seg.minElevation,
    edgeSegments: seg.edgeSegments,
    hazards: seg.hazards ?? [],
    start: seg.start,
    end: seg.end,
    ownership: seg.ownership ?? 'personal',
    carryingVehicle: seg.carryingVehicle ?? false,
    rideshareDetails: seg.details?.rideshareDetails ?? null,
    sharedMobilityDetails: seg.details?.sharedMobilityDetails ?? null,
    stationEntrance: seg.stationEntrance ?? null,
    ...extractTransitFields(seg),
  }
}

/** Map one scored backend candidate to the flattened UI trip. */
export function mapCandidate(candidate: any, idx: number): any {
  const stats = candidate.trip.tripStats
  return {
    id: `${candidate.trip.requestId || `trip-${Date.now()}`}-${idx}`,
    mode: normalizeMode(candidate.trip.segments[0]?.mode || 'walking'),
    vehicleType: candidate.trip.segments[0]?.vehicle?.type || 'walking',
    summary: {
      totalDuration: stats.totalDuration,
      totalDistance: stats.totalDistance,
      hasTolls: false,
      hasHighways: false,
      hasFerries: false,
    },
    segments: flattenSegments(candidate.trip.segments),
    startTime: new Date(candidate.trip.earliestStartTime),
    endTime: new Date(candidate.trip.latestEndTime),
    isRecommended: candidate.rank === 1,
    rank: candidate.rank,
    provider: 'multimodal',
    cost: stats.totalCost
      ? { total: { amount: stats.totalCost.value, currency: stats.totalCost.currency } }
      : undefined,
    co2Emissions: stats.totalCo2 ?? undefined,
  }
}

/**
 * Flatten multimodal segments into single array.
 * Transit segments get extra fields (lineName, lineColor, stops, etc.).
 */
function flattenSegments(segments: any[]): any[] {
  return segments.flatMap(segment => {
    if (segment.details?.multimodalSegments) {
      return segment.details.multimodalSegments.map(
        (seg: any, i: number) =>
          mapSegment(
            seg,
            `segment-${segment.segmentIndex}-${i}`,
            seg.legIndex ?? segment.legIndex ?? 0,
          ),
      )
    }

    return [
      mapSegment(
        segment,
        `segment-${segment.segmentIndex}`,
        segment.legIndex ?? 0,
      ),
    ]
  })
}
