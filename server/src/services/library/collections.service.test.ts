/**
 * Unit tests for the pure helpers + typed errors exposed by the
 * collections service. Full DB-backed flow coverage (scheme switch,
 * rotate-key transactional apply, public-link resolver) is covered by
 * manual E2E in Chrome and is tracked as a follow-up integration suite
 * when the share system gets its own test harness.
 */

import { describe, test, expect } from 'bun:test'
import {
  PublicLinkNotAllowedOnE2eeError,
  RotationVersionError,
  SchemeAlreadySetError,
} from './collections.service'

describe('PublicLinkNotAllowedOnE2eeError', () => {
  test('has a useful name and message', () => {
    const err = new PublicLinkNotAllowedOnE2eeError()
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('PublicLinkNotAllowedOnE2eeError')
    expect(err.message).toContain('server-key')
  })
})

describe('RotationVersionError', () => {
  test('captures both current and proposed version in the message', () => {
    const err = new RotationVersionError(3, 2)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('RotationVersionError')
    expect(err.message).toContain('3')
    expect(err.message).toContain('2')
  })
})

describe('SchemeAlreadySetError', () => {
  test('reports the scheme that matched current state', () => {
    const err = new SchemeAlreadySetError('user-e2ee')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('SchemeAlreadySetError')
    expect(err.message).toContain('user-e2ee')
  })
})
