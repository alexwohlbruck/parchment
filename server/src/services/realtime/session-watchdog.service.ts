import { and, gt, inArray } from 'drizzle-orm'
import { db } from '../../db'
import { sessions } from '../../schema/sessions.schema'
import { logger } from '../../lib/logger'
import { allConnections, closeSessions } from './registry.service'

const CHECK_INTERVAL_MS = 5 * 60 * 1000
const BATCH = 500

/**
 * Close sockets whose session has expired or vanished. Sessions slide, so
 * the expiry is re-read from the database rather than fixed at connect time.
 */
export async function closeExpiredSessionSockets(now = new Date()): Promise<number> {
  const ids = [
    ...new Set(
      allConnections()
        .map((c) => c.sessionId)
        .filter((id): id is string => !!id),
    ),
  ]
  if (ids.length === 0) return 0

  const live = new Set<string>()
  for (let i = 0; i < ids.length; i += BATCH) {
    const rows = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(inArray(sessions.id, ids.slice(i, i + BATCH)), gt(sessions.expiresAt, now)))
    for (const row of rows) live.add(row.id)
  }

  const ended = ids.filter((id) => !live.has(id))
  if (ended.length > 0) closeSessions(ended)
  return ended.length
}

let timer: ReturnType<typeof setInterval> | null = null

export function startSessionWatchdog(): void {
  if (timer || process.env.NODE_ENV === 'test') return
  timer = setInterval(() => {
    closeExpiredSessionSockets()
      .then((count) => {
        if (count > 0) logger.info({ count }, 'Closed sockets for expired sessions')
      })
      .catch((err) => logger.error({ err }, 'Session watchdog failed'))
  }, CHECK_INTERVAL_MS)
  timer.unref?.()
}
