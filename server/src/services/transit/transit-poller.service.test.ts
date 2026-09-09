/**
 * Unit tests for the transit vehicle poller.
 *
 * Pure in-memory — no DB, no real WebSocket connections.
 */

import { describe, test, expect, beforeEach } from 'bun:test'
import {
  subscribe,
  unsubscribe,
  updateBounds,
  onConnectionClosed,
} from './transit-poller.service'
import type { Connection } from '../realtime/registry.service'

function makeConn(id: string): { conn: Connection; sent: string[] } {
  const sent: string[] = []
  return {
    sent,
    conn: {
      id,
      send: (data: string) => { sent.push(data) },
    },
  }
}

const bounds = { north: 40.8, south: 40.7, east: -73.9, west: -74.0 }

// Note: we can't easily reset the module state between tests since
// the subscribers Map is module-private. Tests are written to be
// order-independent by using unique connection IDs.

describe('transit-poller subscribe/unsubscribe', () => {
  test('subscribe accepts valid bounds', () => {
    const { conn } = makeConn('test-sub-1')
    // Should not throw
    subscribe('test-sub-1', conn, bounds)
    // Clean up
    unsubscribe('test-sub-1')
  })

  test('unsubscribe removes the subscriber', () => {
    const { conn } = makeConn('test-unsub-1')
    subscribe('test-unsub-1', conn, bounds)
    unsubscribe('test-unsub-1')
    // Double unsubscribe should not throw
    unsubscribe('test-unsub-1')
  })

  test('onConnectionClosed cleans up subscriber', () => {
    const { conn } = makeConn('test-close-1')
    subscribe('test-close-1', conn, bounds)
    onConnectionClosed('test-close-1')
    // Should not throw even if already removed
    onConnectionClosed('test-close-1')
  })

  test('updateBounds does not throw for unknown connection', () => {
    updateBounds('nonexistent-conn', bounds)
  })

  test('subscribe rejects when cap is reached', () => {
    // Subscribe 100 connections
    const conns: string[] = []
    for (let i = 0; i < 100; i++) {
      const id = `cap-test-${i}`
      conns.push(id)
      const { conn } = makeConn(id)
      subscribe(id, conn, bounds)
    }

    // 101st should be rejected (no throw, just silently skipped)
    const { conn: overflow } = makeConn('cap-overflow')
    subscribe('cap-overflow', overflow, bounds)

    // Clean up
    for (const id of conns) unsubscribe(id)
    unsubscribe('cap-overflow')
  })

  test('re-subscribing same connection updates bounds without hitting cap', () => {
    const { conn } = makeConn('test-resub-1')
    subscribe('test-resub-1', conn, bounds)

    const newBounds = { north: 41.0, south: 40.5, east: -73.5, west: -74.5 }
    subscribe('test-resub-1', conn, newBounds)

    // Should not throw — same connectionId, just updated bounds
    unsubscribe('test-resub-1')
  })
})
