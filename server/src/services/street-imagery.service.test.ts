/**
 * Unit tests for street-imagery lookups.
 *
 * This powers a floating preview on the place detail, so every failure mode
 * has to degrade to `null` rather than throw — an unconfigured Mapillary
 * integration or a provider outage should hide the preview, not break the page.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'

let configuredIntegrations: any[] = []
let instance: any = null

const getConfiguredIntegrations = mock(() => configuredIntegrations)
const getCachedIntegrationInstance = mock(() => instance)

mock.module('./integrations', () => ({
  integrationManager: {
    getConfiguredIntegrations,
    getCachedIntegrationInstance,
  },
}))

mock.module('./integrations/mapillary-integration', () => ({
  MapillaryIntegration: class {},
}))

mock.module('../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
  logError: () => {},
  logWarn: () => {},
}))

const { fetchNearestStreetImage } = await import('./street-imagery.service')

const preview = { id: 'img-1', url: 'https://images.test/1.jpg' }
const findNearestImage = mock(async (_lat: number, _lng: number) => preview as any)

beforeEach(() => {
  configuredIntegrations = [{ integrationId: 'mapillary' }]
  instance = { findNearestImage }
  findNearestImage.mockClear()
  findNearestImage.mockImplementation(async () => preview)
  getConfiguredIntegrations.mockClear()
  getCachedIntegrationInstance.mockClear()
})

describe('fetchNearestStreetImage', () => {
  test('returns the nearest image from Mapillary', async () => {
    const result = await fetchNearestStreetImage(35.2, -80.8)

    expect(result).toEqual(preview)
    expect(findNearestImage).toHaveBeenCalledWith(35.2, -80.8)
  })

  test('returns null when Mapillary is not configured', async () => {
    configuredIntegrations = []

    expect(await fetchNearestStreetImage(35.2, -80.8)).toBeNull()
    expect(findNearestImage).not.toHaveBeenCalled()
  })

  test('returns null when the integration has no cached instance', async () => {
    instance = null

    expect(await fetchNearestStreetImage(35.2, -80.8)).toBeNull()
  })

  test('ignores integrations other than Mapillary', async () => {
    configuredIntegrations = [{ integrationId: 'google' }]

    expect(await fetchNearestStreetImage(35.2, -80.8)).toBeNull()
  })

  test('returns null when no imagery exists nearby', async () => {
    findNearestImage.mockResolvedValueOnce(null)

    expect(await fetchNearestStreetImage(0, 0)).toBeNull()
  })

  test('swallows a provider failure rather than throwing', async () => {
    // The caller renders a place page; a Mapillary outage must not break it.
    findNearestImage.mockRejectedValueOnce(new Error('mapillary 429'))

    expect(await fetchNearestStreetImage(35.2, -80.8)).toBeNull()
  })

  test('passes coordinates through unrounded', async () => {
    await fetchNearestStreetImage(35.227131, -80.843121)

    expect(findNearestImage).toHaveBeenCalledWith(35.227131, -80.843121)
  })
})
