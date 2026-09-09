import type { TripLegOptions, TripOption, TripsResponse } from '@/types/directions.types'

/**
 * Stitch each leg's leading option into the single trip the UI shows.
 *
 * Mirrors what the server does when it first assembles the chain, so a trip
 * the user has re-picked a leg of stays the same shape as one they haven't
 * touched. Totals come from the legs rather than from the segments: a transit
 * fare is folded onto the leg, not onto any one segment of it.
 */
export function composeLegChain(
  response: TripsResponse,
  legs: TripLegOptions[],
): TripsResponse {
  const chosen = legs.map((leg) => leg.options[0])
  const segments = chosen.flatMap((option, legIndex) =>
    option.segments.map((segment, i) => ({
      ...segment,
      legIndex,
      id: `leg${legIndex}-${i}`,
    })),
  )

  const sum = (pick: (option: TripOption) => number | undefined) =>
    chosen.reduce((total, option) => total + (pick(option) ?? 0), 0)

  const currency = chosen.find((o) => o.cost?.total)?.cost?.total?.currency
  const mixedCurrency = chosen.some(
    (o) => o.cost?.total && o.cost.total.currency !== currency,
  )
  const cost = currency && !mixedCurrency
    ? { total: { amount: sum((o) => o.cost?.total?.amount), currency } }
    : undefined

  const chain: TripOption = {
    ...chosen[0],
    id: `${response.trips[0]?.id ?? 'trip'}-relegged`,
    segments,
    startTime: chosen[0].startTime,
    endTime: chosen[chosen.length - 1].endTime,
    summary: {
      ...chosen[0].summary,
      totalDuration: sum((o) => o.summary.totalDuration),
      totalDistance: sum((o) => o.summary.totalDistance),
    },
    isRecommended: true,
    rank: 1,
    cost,
    co2Emissions: chosen.some((o) => o.co2Emissions != null)
      ? sum((o) => o.co2Emissions)
      : undefined,
  }

  return {
    ...response,
    legs,
    trips: [chain],
    earliestStart: chain.startTime,
    latestEnd: chain.endTime,
  }
}
