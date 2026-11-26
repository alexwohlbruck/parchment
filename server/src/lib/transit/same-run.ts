/** NYC subway realtime names a run without the timetable's shape suffix: `054550_A..S` for `054550_A..S57R`. */
const withoutShape = (tripId: string) => tripId.replace(/(\.\.[NS])[0-9A-Z]*$/, '$1')

/** A timetable run id (`{date}_{time}_{feed}_{trip}`, or a bare trip) and a realtime vehicle's trip name the same run. */
export function sameRun(timetableTripId: string, vehicleTripId: string): boolean {
  const run = withoutShape(timetableTripId)
  const vehicle = withoutShape(vehicleTripId)
  return run === vehicle || run.endsWith(`_${vehicle}`)
}
