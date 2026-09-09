/**
 * Whether a line is calling at a stop right now, judged from its departure
 * board.
 *
 * The naive test — "this line has no run on the board, so it isn't running" —
 * is wrong, and wrong in a way that looks like data. MOTIS sizes a board by a
 * count of events, not by time, and it shares that count across every stop
 * sharing the requested one's name. So the span a page actually buys collapses
 * as a complex gets busier: measured at Times Sq, 50 events reached 13 minutes
 * ahead at rush hour and 75 minutes ahead at three in the morning, while a
 * two-line stop like Prince St reached past dawn either way.
 *
 * Read literally, that made the R's timeline a barber pole at 03:20 — solid at
 * Prince St and 8 St, dashed at Canal St and Union Sq — when the truth is that
 * the R was running as the Whitehall–Bay Ridge shuttle and calling at none of
 * them. The pattern tracked how busy each station was, not the timetable.
 *
 * So the question is asked with a fixed horizon instead. Every stop is asked
 * "does this line have a run in the next 90 minutes", the boards that reach
 * further are cut back to it, and a board too short to answer says nothing at
 * all rather than guessing.
 */

/** How far ahead "running here" looks. Long enough for a night headway, short
 *  enough that tomorrow's first train is not mistaken for tonight's service. */
export const SERVICE_WINDOW_MINUTES = 90

/** A board reaching less far than this is not evidence of anything, and the
 *  stop is reported as unanswered rather than dimmed. */
export const MIN_HORIZON_MINUTES = 20

/** Events per board. Sized from the worst case measured — the five boards of
 *  the Times Sq complex at rush hour, where 50 events reached 13 minutes and
 *  150 reaches 40, comfortably past the floor above. */
export const SERVICE_BOARD_EVENTS = 150

export interface ServiceBoard {
  departures?: Array<{
    route?: { id?: string }
    departureTime?: string
    scheduledDepartureTime?: string
  }>
  /** Barrelman's flag for "the timetable had more to give" — a full page. */
  hasMore?: boolean
}

const departureAt = (d: NonNullable<ServiceBoard['departures']>[number]): number =>
  Date.parse(d.departureTime || d.scheduledDepartureTime || '')

/**
 * The lines with a run at this stop inside the window, or `null` when the
 * boards don't reach far enough to say.
 *
 * A stop is usually several boards — the platforms of its complex and the
 * stations `transfers.txt` joins to it — and each is truncated separately, so
 * the answer is only as good as the shortest of them. An empty board is
 * skipped rather than counted as a short one: it names no line and fixes no
 * horizon, and letting one dictate the result would have made Times Sq
 * unanswerable at night because the 42 St shuttle had gone to bed.
 *
 * Every board being empty is a different thing, and a real one: nothing
 * departs from here at all, which is what a branch looks like once the last
 * train has run.
 */
export function routesRunningAt(boards: ServiceBoard[], now: number): string[] | null {
  const windowEnd = now + SERVICE_WINDOW_MINUTES * 60_000
  const runs: Array<{ routeId: string; at: number }> = []
  let knownUntil = Infinity

  for (const board of boards) {
    const departures = board.departures ?? []
    if (!departures.length) continue

    let last = 0
    for (const d of departures) {
      const at = departureAt(d)
      // A run whose time won't parse still proves the line is on the board.
      // Counting it as due now errs towards leaving the bullet lit, which is
      // the harmless direction to be wrong in.
      if (d.route?.id) runs.push({ routeId: d.route.id, at: Number.isNaN(at) ? now : at })
      if (!Number.isNaN(at) && at > last) last = at
    }

    // A full page means the timetable had more to give, so this board is silent
    // about everything past its last run. A short one is complete.
    if (board.hasMore && last) knownUntil = Math.min(knownUntil, last)
  }

  const until = Math.min(knownUntil, windowEnd)
  if (until - now < MIN_HORIZON_MINUTES * 60_000) return null

  return [...new Set(runs.filter((r) => r.at <= until).map((r) => r.routeId))]
}
