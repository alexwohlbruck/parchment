import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useStorage } from '@vueuse/core'
import { toast } from '@/lib/toast'
import { v4 as uuidv4 } from 'uuid'
import { i18n } from '@/lib/i18n'
import { isOffline, onReconnected } from '@/lib/connectivity'
import {
  getNetworkErrorKind,
  isRetriableNetworkError,
} from '@/lib/network-errors'
import { getMutationHandler } from '@/lib/sync/mutation-registry'
import type {
  MutationContext,
  QueuedMutation,
} from '@/lib/sync/types'

/**
 * The offline mutation queue.
 *
 * Writes performed while offline are applied optimistically by their feature
 * service and persisted here; the queue replays them in order once
 * connectivity returns. Entries survive reloads (localStorage), so a change
 * made offline on Monday still syncs when the app next opens with a network.
 *
 * A retriable failure (still offline, server unreachable, timeout) leaves
 * the entry pending for the next reconnect. A definitive failure (4xx, bad
 * payload) marks it `failed`, rolls the optimistic change back, and keeps
 * the entry visible in the sync UI for retry or dismissal.
 */
export const useSyncStore = defineStore('sync', () => {
  const queue = useStorage<QueuedMutation[]>('parchment-sync-queue', [])
  // offline temp id → server id, persisted so a flush interrupted mid-way
  // (reload, crash) can still resolve references on the next attempt.
  const idMap = useStorage<Record<string, string>>('parchment-sync-id-map', {})

  // A reload can leave an entry stuck in `syncing` — its request either
  // landed (replay is idempotent) or died with the page. Resume as pending.
  queue.value = queue.value.map(item =>
    item.status === 'syncing' ? { ...item, status: 'pending' as const } : item,
  )

  const isFlushing = ref(false)

  const pendingMutations = computed(() =>
    queue.value.filter(item => item.status !== 'failed'),
  )
  const failedMutations = computed(() =>
    queue.value.filter(item => item.status === 'failed'),
  )
  const hasWork = computed(() => queue.value.length > 0)

  const ctx: MutationContext = {
    resolveId(id) {
      return idMap.value[id] ?? id
    },
    mapId(tempId, serverId) {
      idMap.value = { ...idMap.value, [tempId]: serverId }
    },
  }

  function patch(id: string, changes: Partial<QueuedMutation>) {
    queue.value = queue.value.map(item =>
      item.id === id ? { ...item, ...changes } : item,
    )
  }

  function remove(id: string) {
    queue.value = queue.value.filter(item => item.id !== id)
    if (queue.value.length === 0) idMap.value = {}
  }

  /**
   * Queue a mutation for replay. The caller has already applied the
   * optimistic local change. Flushes immediately when a network is
   * available (covers "the request failed but we're back online" races).
   */
  function enqueue(type: string, payload: unknown, label: string): string {
    const id = uuidv4()
    queue.value = [
      ...queue.value,
      {
        id,
        type,
        payload,
        label,
        createdAt: Date.now(),
        attempts: 0,
        status: 'pending',
      },
    ]
    if (!isOffline.value) void flush()
    return id
  }

  /**
   * Queue a mutation that supersedes any pending one with the same key.
   * For repeated saves of the same thing, only the newest matters.
   */
  function enqueueLatest(
    type: string,
    key: string,
    payload: unknown,
    label: string,
  ): string {
    const existing = queue.value.find(
      entry => entry.key === key && entry.status === 'pending',
    )
    if (existing) {
      patch(existing.id, { payload, label, createdAt: Date.now() })
      if (!isOffline.value) void flush()
      return existing.id
    }
    const id = enqueue(type, payload, label)
    patch(id, { key })
    return id
  }

  async function flush(): Promise<void> {
    if (isFlushing.value) return
    isFlushing.value = true
    try {
      // Entries whose handler this build doesn't know about are skipped
      // rather than dropped — a later build may still be able to replay
      // them — but must not be retried in a loop within one flush.
      const skipped = new Set<string>()
      while (!isOffline.value) {
        const item = queue.value.find(
          entry => entry.status === 'pending' && !skipped.has(entry.id),
        )
        if (!item) break

        const handler = getMutationHandler(item.type)
        if (!handler) {
          console.warn('[sync] no handler for queued mutation', item.type)
          skipped.add(item.id)
          continue
        }

        patch(item.id, { status: 'syncing', attempts: item.attempts + 1 })
        try {
          await handler.execute(item.payload, ctx)
          remove(item.id)
        } catch (error) {
          if (isRetriableNetworkError(getNetworkErrorKind(error))) {
            // Connectivity dropped again — wait for the next reconnect.
            patch(item.id, { status: 'pending' })
            break
          }
          const message =
            error instanceof Error ? error.message : String(error)
          patch(item.id, { status: 'failed', error: message })
          try {
            handler.rollback?.(item.payload)
          } catch (rollbackError) {
            console.error('[sync] rollback failed', rollbackError)
          }
          toast.error(
            (i18n.global as any).t('offline.sync.failedToast', {
              label: item.label,
            }),
          )
        }
      }
    } finally {
      isFlushing.value = false
    }
  }

  /**
   * Drop a queued create for an entity that has since been deleted locally.
   * Returns true when one was found — the caller then has nothing to send,
   * because the server never heard of it in the first place.
   */
  function cancelPendingCreate(type: string, entityId: string): boolean {
    const item = queue.value.find(
      entry =>
        entry.type === type &&
        entry.status !== 'syncing' &&
        (entry.payload as { tempId?: string })?.tempId === entityId,
    )
    if (!item) return false
    remove(item.id)
    return true
  }

  /** Cancel a pending mutation: undo its optimistic change and drop it. */
  function cancel(id: string) {
    const item = queue.value.find(entry => entry.id === id)
    if (!item || item.status === 'syncing') return
    try {
      getMutationHandler(item.type)?.rollback?.(item.payload)
    } catch (error) {
      console.error('[sync] rollback failed', error)
    }
    remove(id)
  }

  /** Re-queue a failed mutation. Its optimistic state was rolled back, so
   * a successful replay re-applies the server's answer to the stores. */
  function retry(id: string) {
    patch(id, { status: 'pending', error: undefined })
    if (!isOffline.value) void flush()
  }

  /** Drop a failed mutation without retrying (rollback already happened). */
  function dismiss(id: string) {
    remove(id)
  }

  /** Sign-out: queued work belongs to the previous session. */
  function clear() {
    queue.value = []
    idMap.value = {}
  }

  onReconnected(() => void flush())
  // Replay anything left over from a previous session on startup.
  if (!isOffline.value && queue.value.some(i => i.status === 'pending')) {
    void flush()
  }

  return {
    queue,
    pendingMutations,
    failedMutations,
    hasWork,
    isFlushing,
    enqueue,
    enqueueLatest,
    flush,
    cancel,
    cancelPendingCreate,
    retry,
    dismiss,
    clear,
    resolveId: ctx.resolveId,
  }
})
