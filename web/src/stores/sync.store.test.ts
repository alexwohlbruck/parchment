/**
 * Unit tests for the offline mutation queue.
 *
 * The behaviour that matters: entries persist and replay in order, a
 * retriable failure leaves the entry pending for the next reconnect, a
 * definitive failure rolls back and stays visible as failed, cancel undoes
 * the optimistic change, and temp ids created offline resolve to server ids
 * across dependent entries.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import {
  _resetConnectivityForTests,
  reportServerReachable,
  reportServerUnreachable,
} from '@/lib/connectivity'
import { registerMutationHandler } from '@/lib/sync/mutation-registry'
import { useSyncStore } from './sync.store'

vi.mock('vue-sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/lib/i18n', () => ({
  i18n: { global: { t: (key: string) => key } },
  storedLocale: { value: 'en-US' },
}))

const config = { method: 'post', url: '/x' } as InternalAxiosRequestConfig

function networkError(): AxiosError {
  return new AxiosError('boom', 'ERR_NETWORK', config, {})
}

function clientError(status: number): AxiosError {
  return new AxiosError(
    'rejected',
    undefined,
    config,
    {},
    { status, statusText: '', headers: {}, config, data: {} } as never,
  )
}

/** Let queued microtasks (the flush loop) settle. */
async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  await new Promise(resolve => setTimeout(resolve, 0))
}

let counter = 0
function uniqueType() {
  return `test:mutation-${++counter}`
}

describe('sync store', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    _resetConnectivityForTests()
  })

  test('replays queued mutations in order once online', async () => {
    const calls: string[] = []
    const type = uniqueType()
    registerMutationHandler(type, {
      execute: async (payload: { step: string }) => {
        calls.push(payload.step)
      },
    })

    reportServerUnreachable()
    const store = useSyncStore()
    store.enqueue(type, { step: 'a' }, 'A')
    store.enqueue(type, { step: 'b' }, 'B')
    expect(store.queue).toHaveLength(2)

    reportServerReachable()
    await store.flush()

    expect(calls).toEqual(['a', 'b'])
    expect(store.queue).toHaveLength(0)
  })

  test('a retriable failure leaves the entry pending', async () => {
    const type = uniqueType()
    const execute = vi.fn().mockRejectedValue(networkError())
    registerMutationHandler(type, { execute })

    reportServerUnreachable()
    const store = useSyncStore()
    store.enqueue(type, {}, 'A')

    reportServerReachable()
    await store.flush()

    expect(store.queue).toHaveLength(1)
    expect(store.queue[0].status).toBe('pending')
    expect(store.failedMutations).toHaveLength(0)
  })

  test('a definitive failure rolls back and marks the entry failed', async () => {
    const type = uniqueType()
    const rollback = vi.fn()
    registerMutationHandler(type, {
      execute: vi.fn().mockRejectedValue(clientError(422)),
      rollback,
    })

    reportServerUnreachable()
    const store = useSyncStore()
    store.enqueue(type, { x: 1 }, 'A')

    reportServerReachable()
    await store.flush()

    expect(rollback).toHaveBeenCalledWith({ x: 1 })
    expect(store.failedMutations).toHaveLength(1)
    expect(store.failedMutations[0].status).toBe('failed')
  })

  test('a failed entry keeps later entries flowing', async () => {
    const badType = uniqueType()
    const goodType = uniqueType()
    const executed = vi.fn()
    registerMutationHandler(badType, {
      execute: vi.fn().mockRejectedValue(clientError(400)),
    })
    registerMutationHandler(goodType, { execute: executed })

    reportServerUnreachable()
    const store = useSyncStore()
    store.enqueue(badType, {}, 'bad')
    store.enqueue(goodType, {}, 'good')

    reportServerReachable()
    await store.flush()

    expect(executed).toHaveBeenCalled()
    expect(store.queue).toHaveLength(1)
    expect(store.queue[0].status).toBe('failed')
  })

  test('cancel rolls back and removes a pending entry', async () => {
    const type = uniqueType()
    const rollback = vi.fn()
    registerMutationHandler(type, { execute: vi.fn(), rollback })

    reportServerUnreachable()
    const store = useSyncStore()
    const id = store.enqueue(type, { x: 2 }, 'A')
    store.cancel(id)

    expect(rollback).toHaveBeenCalledWith({ x: 2 })
    expect(store.queue).toHaveLength(0)
  })

  test('retry re-queues a failed entry and replays it', async () => {
    const type = uniqueType()
    const execute = vi
      .fn()
      .mockRejectedValueOnce(clientError(500 - 100)) // 400: definitive
      .mockResolvedValueOnce(undefined)
    registerMutationHandler(type, { execute })

    reportServerUnreachable()
    const store = useSyncStore()
    const id = store.enqueue(type, {}, 'A')
    reportServerReachable()
    await store.flush()
    expect(store.failedMutations).toHaveLength(1)

    store.retry(id)
    await settle()
    expect(store.queue).toHaveLength(0)
  })

  test('temp ids map to server ids across dependent entries', async () => {
    const createType = uniqueType()
    const updateType = uniqueType()
    const seen: string[] = []
    registerMutationHandler(createType, {
      execute: async (payload: { tempId: string }, ctx) => {
        ctx.mapId(payload.tempId, 'server-1')
      },
    })
    registerMutationHandler(updateType, {
      execute: async (payload: { id: string }, ctx) => {
        seen.push(ctx.resolveId(payload.id))
      },
    })

    reportServerUnreachable()
    const store = useSyncStore()
    store.enqueue(createType, { tempId: 'offline-abc' }, 'create')
    store.enqueue(updateType, { id: 'offline-abc' }, 'update')

    reportServerReachable()
    await store.flush()

    expect(seen).toEqual(['server-1'])
  })

  test('queue entries persist across store instances', async () => {
    reportServerUnreachable()
    const store = useSyncStore()
    store.enqueue(uniqueType(), { x: 1 }, 'A')
    // useStorage writes on the pre-flush tick; let it land before "reloading".
    await nextTick()

    setActivePinia(createPinia())
    const reloaded = useSyncStore()
    expect(reloaded.queue).toHaveLength(1)
    expect(reloaded.queue[0].label).toBe('A')
  })

  test('interrupted syncing entries resume as pending', () => {
    localStorage.setItem(
      'parchment-sync-queue',
      JSON.stringify([
        {
          id: '1',
          type: 'x',
          payload: {},
          label: 'A',
          createdAt: 0,
          attempts: 1,
          status: 'syncing',
        },
      ]),
    )
    reportServerUnreachable()
    setActivePinia(createPinia())
    const store = useSyncStore()
    expect(store.queue[0].status).toBe('pending')
  })
})
