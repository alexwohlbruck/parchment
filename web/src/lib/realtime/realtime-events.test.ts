/**
 * Unit tests for the event dispatcher.
 *
 * Pure — no sockets, no Vue, no Pinia.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import {
  registerRealtimeHandlers,
  dispatch,
  _registeredOwners,
  _resetForTests,
} from './realtime-events'

beforeEach(() => {
  _resetForTests()
})

describe('realtime-events dispatch', () => {
  test('routes an event to the single matching handler', () => {
    const fn = vi.fn()
    registerRealtimeHandlers('ownerA', { 'e:1': fn })
    dispatch('e:1', { hello: 'world' })
    expect(fn).toHaveBeenCalledWith({ hello: 'world' })
  })

  test('routes the same event to multiple owners', () => {
    const a = vi.fn()
    const b = vi.fn()
    registerRealtimeHandlers('ownerA', { 'shared:event': a })
    registerRealtimeHandlers('ownerB', { 'shared:event': b })
    dispatch('shared:event', 42)
    expect(a).toHaveBeenCalledWith(42)
    expect(b).toHaveBeenCalledWith(42)
  })

  test('unknown events are no-ops', () => {
    // Just asserting no throw.
    dispatch('nothing:here', {})
  })

  test('re-registering the same owner replaces the handler map', () => {
    const first = vi.fn()
    const second = vi.fn()
    registerRealtimeHandlers('o', { 'e:1': first })
    registerRealtimeHandlers('o', { 'e:1': second })
    dispatch('e:1', {})
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalled()
  })

  test('a throwing handler does not block other owners', () => {
    const good = vi.fn()
    registerRealtimeHandlers('bad', {
      'e:1': () => {
        throw new Error('boom')
      },
    })
    registerRealtimeHandlers('good', { 'e:1': good })
    dispatch('e:1', {})
    expect(good).toHaveBeenCalled()
  })

  test('_registeredOwners returns the list of owner keys', () => {
    registerRealtimeHandlers('x', { 'a:b': vi.fn() })
    registerRealtimeHandlers('y', { 'a:b': vi.fn() })
    expect(_registeredOwners().sort()).toEqual(['x', 'y'])
  })
})
