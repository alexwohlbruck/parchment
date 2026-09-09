import { v4 as uuidv4 } from 'uuid'

/**
 * Ids are minted by the server, so an entity created offline gets a local
 * placeholder id until its queued create replays. The prefix makes these
 * recognizable everywhere: stores use it to protect optimistic rows from
 * being clobbered by refetches, and the queue remaps them to server ids
 * as creates succeed.
 */
export const OFFLINE_ID_PREFIX = 'offline-'

export function newOfflineId(): string {
  return OFFLINE_ID_PREFIX + uuidv4()
}

export function isOfflineId(id: unknown): boolean {
  return typeof id === 'string' && id.startsWith(OFFLINE_ID_PREFIX)
}
