import { createHash } from 'node:crypto'

/** A stable, non-secret name for a session: its id is the bearer token. */
export function publicSessionId(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('base64url')
}
