export type MutationStatus = 'pending' | 'syncing' | 'failed'

/** One persisted entry in the offline mutation queue. */
export interface QueuedMutation<P = unknown> {
  id: string
  /** Handler key, e.g. `bookmark:create`. */
  type: string
  payload: P
  /** Localized, human-readable description for the sync UI. */
  label: string
  /**
   * Coalescing key. Entries sharing one supersede each other while pending
   * — repeatedly saving a canvas queues one entry carrying the latest
   * body, not one per edit.
   */
  key?: string
  createdAt: number
  attempts: number
  status: MutationStatus
  error?: string
}

export interface MutationContext {
  /** Resolve a possibly-offline id to its server id, if one is known yet. */
  resolveId(id: string): string
  /** Record that an offline temp id now has a server id. */
  mapId(tempId: string, serverId: string): void
}

/**
 * A replayable mutation. `execute` performs the server write and applies the
 * server's answer to local state (store methods are idempotent upserts, so
 * replay after a partial flush is safe). `rollback` undoes the optimistic
 * local change when the mutation is cancelled or fails permanently.
 */
export interface MutationHandler<P = any> {
  execute(payload: P, ctx: MutationContext): Promise<void>
  rollback?(payload: P): void
}
