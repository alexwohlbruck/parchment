/**
 * Unit tests for the connection registry.
 *
 * Pure in-memory — no DB, no sockets. Uses stub `Connection` objects.
 */

import { describe, test, expect, beforeEach } from 'bun:test'
import {
  add,
  removeById,
  socketsForUser,
  connectedUserCount,
  totalSocketCount,
  _resetForTests,
  type Connection,
} from './registry.service'

function makeConn(id: string): Connection {
  return { id, send: () => {} }
}

beforeEach(() => {
  _resetForTests()
})

describe('registry.add', () => {
  test('single connection for single user', () => {
    add('u1', makeConn('c1'))
    expect(connectedUserCount()).toBe(1)
    expect(totalSocketCount()).toBe(1)
    expect(socketsForUser('u1')).toHaveLength(1)
  })

  test('multiple devices for one user keep separate entries', () => {
    add('u1', makeConn('c1'))
    add('u1', makeConn('c2'))
    add('u1', makeConn('c3'))
    expect(connectedUserCount()).toBe(1)
    expect(totalSocketCount()).toBe(3)
    expect(socketsForUser('u1')).toHaveLength(3)
  })

  test('multiple users are independent', () => {
    add('u1', makeConn('c1'))
    add('u2', makeConn('c2'))
    expect(connectedUserCount()).toBe(2)
    expect(socketsForUser('u1')).toHaveLength(1)
    expect(socketsForUser('u2')).toHaveLength(1)
  })

  test('re-adding same id replaces the old entry (no leak)', () => {
    add('u1', makeConn('c1'))
    add('u1', makeConn('c1')) // same id
    expect(totalSocketCount()).toBe(1)
  })
})

describe('registry.removeById', () => {
  test('removes the connection from its user', () => {
    add('u1', makeConn('c1'))
    add('u1', makeConn('c2'))
    removeById('c1')
    expect(totalSocketCount()).toBe(1)
    expect(socketsForUser('u1')).toHaveLength(1)
  })

  test('drops the user bucket when the last connection leaves', () => {
    add('u1', makeConn('c1'))
    removeById('c1')
    expect(connectedUserCount()).toBe(0)
    expect(socketsForUser('u1')).toHaveLength(0)
  })

  test('unknown id is a no-op', () => {
    add('u1', makeConn('c1'))
    removeById('bogus')
    expect(totalSocketCount()).toBe(1)
  })
})

describe('registry.socketsForUser', () => {
  test('returns a fresh array (safe to iterate during concurrent add)', () => {
    add('u1', makeConn('c1'))
    const list = socketsForUser('u1')
    add('u1', makeConn('c2'))
    expect(list).toHaveLength(1) // snapshot didn't grow
  })

  test('empty array for unknown user', () => {
    expect(socketsForUser('nobody')).toEqual([])
  })
})
