/**
 * The transition tracking is the contract under test: a burst of failing
 * requests must produce exactly one degraded event, and recovery must emit
 * only after a known failure — otherwise every successful request would
 * spam each of the user's devices.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'

const publish = mock(
  (event: string, payload: unknown, recipients: unknown) => ({
    id: 'evt-1',
    event,
    payload,
    recipients,
    timestamp: '2026-01-01T00:00:00.000Z',
  }),
)

mock.module('../realtime/event-bus.service', () => ({ publish }))

import {
  reportIntegrationFailure,
  reportIntegrationSuccess,
  resetIntegrationHealthState,
} from './integration-health.service'

describe('integration health transitions', () => {
  beforeEach(() => {
    publish.mockClear()
    resetIntegrationHealthState()
  })

  test('first failure emits degraded to the user', () => {
    reportIntegrationFailure('u1', 'dawarich')

    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenCalledWith(
      'integration:degraded',
      { integrationId: 'dawarich' },
      { localUserIds: ['u1'], remoteHandles: [] },
    )
  })

  test('repeated failures do not re-emit', () => {
    reportIntegrationFailure('u1', 'dawarich')
    reportIntegrationFailure('u1', 'dawarich')
    reportIntegrationFailure('u1', 'dawarich')

    expect(publish).toHaveBeenCalledTimes(1)
  })

  test('success after failure emits recovered once', () => {
    reportIntegrationFailure('u1', 'dawarich')
    reportIntegrationSuccess('u1', 'dawarich')
    reportIntegrationSuccess('u1', 'dawarich')

    expect(publish).toHaveBeenCalledTimes(2)
    expect(publish).toHaveBeenLastCalledWith(
      'integration:recovered',
      { integrationId: 'dawarich' },
      { localUserIds: ['u1'], remoteHandles: [] },
    )
  })

  test('success without a prior failure emits nothing', () => {
    reportIntegrationSuccess('u1', 'dawarich')

    expect(publish).not.toHaveBeenCalled()
  })

  test('state is tracked per user and per integration', () => {
    reportIntegrationFailure('u1', 'dawarich')
    reportIntegrationFailure('u2', 'dawarich')
    reportIntegrationFailure('u1', 'mapbox')

    expect(publish).toHaveBeenCalledTimes(3)
  })
})
