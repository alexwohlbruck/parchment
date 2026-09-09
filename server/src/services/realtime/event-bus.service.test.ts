/**
 * Unit tests for the event bus.
 *
 * Asserts the subscriber protocol: publish is synchronous from the
 * caller's POV, subscribers run on the microtask queue, errors in one
 * subscriber don't block others.
 */

import { describe, test, expect, beforeEach } from 'bun:test'
import {
  publish,
  register,
  _resetForTests,
  _listSubscribers,
  type EventSubscriber,
  type RealtimeEvent,
  type Recipients,
} from './event-bus.service'

beforeEach(() => {
  _resetForTests()
})

function collector(name: string, behavior?: (e: RealtimeEvent) => void) {
  const seen: RealtimeEvent[] = []
  const sub: EventSubscriber = {
    name,
    deliver(event) {
      seen.push(event)
      behavior?.(event)
    },
  }
  return { sub, seen }
}

describe('event bus', () => {
  test('publish returns a populated envelope with id + timestamp', () => {
    const recipients: Recipients = { localUserIds: ['u1'], remoteHandles: [] }
    const env = publish('x:y', { foo: 1 }, recipients)
    expect(env.event).toBe('x:y')
    expect(env.id).toMatch(/^evt_/)
    expect(typeof env.timestamp).toBe('string')
    expect(env.payload).toEqual({ foo: 1 })
  })

  test('every registered subscriber receives the event', async () => {
    const a = collector('A')
    const b = collector('B')
    register(a.sub)
    register(b.sub)

    publish('hello', { x: 1 }, { localUserIds: ['u1'], remoteHandles: [] })

    // Publish is microtask-queued — wait one tick.
    await new Promise((r) => setTimeout(r, 0))
    expect(a.seen).toHaveLength(1)
    expect(b.seen).toHaveLength(1)
  })

  test('a throwing subscriber does not block others', async () => {
    const ok = collector('ok')
    register({
      name: 'boom',
      deliver() {
        throw new Error('boom')
      },
    })
    register(ok.sub)

    publish('e', {}, { localUserIds: [], remoteHandles: [] })
    await new Promise((r) => setTimeout(r, 0))
    expect(ok.seen).toHaveLength(1) // still delivered
  })

  test('_listSubscribers returns names of registered subscribers', () => {
    register({ name: 'foo', deliver() {} })
    register({ name: 'bar', deliver() {} })
    expect(_listSubscribers()).toEqual(['foo', 'bar'])
  })

  test('publish is synchronous — subscribers do NOT run before it returns', () => {
    let fired = false
    register({
      name: 'sync-probe',
      deliver() {
        fired = true
      },
    })
    publish('z', {}, { localUserIds: [], remoteHandles: [] })
    expect(fired).toBe(false) // queued, not yet fired
  })
})
