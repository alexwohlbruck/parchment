import { describe, expect, it } from 'bun:test'
import { FoursquareIntegration } from './foursquare-integration'
import {
  IntegrationCapabilityId,
  IntegrationId,
} from '../../types/integration.types'
import { SOURCE } from '../../lib/constants'

describe('FoursquareIntegration', () => {
  it('declares the expected id, source and capabilities', () => {
    const fsq = new FoursquareIntegration()
    expect(fsq.integrationId).toBe(IntegrationId.FOURSQUARE)
    expect(fsq.sources).toEqual([SOURCE.FOURSQUARE])
    expect(fsq.capabilityIds).toEqual([
      IntegrationCapabilityId.SEARCH,
      IntegrationCapabilityId.PLACE_INFO,
    ])
    expect(fsq.capabilities.search?.searchPlaces).toBeInstanceOf(Function)
    expect(fsq.capabilities.placeInfo?.getPlaceInfo).toBeInstanceOf(Function)
  })

  it('validates config requires an api key', () => {
    const fsq = new FoursquareIntegration()
    expect(fsq.validateConfig({ apiKey: '' })).toBe(false)
    expect(fsq.validateConfig({ apiKey: 'fsq-key' })).toBe(true)
  })

  it('short-circuits capabilities safely when no api key is configured', async () => {
    const fsq = new FoursquareIntegration()
    // Not initialized → no network call, empty/null results.
    expect(await fsq.capabilities.search!.searchPlaces('coffee', 40, -74)).toEqual(
      [],
    )
    expect(await fsq.capabilities.placeInfo!.getPlaceInfo('abc')).toBeNull()
    expect(
      await fsq.matchPlace('Joe’s Pizza', {
        address: '7 Carmine St',
        city: 'New York',
        cc: 'US',
      }),
    ).toBeNull()
  })

  it('testConnection fails cleanly without an api key', async () => {
    const fsq = new FoursquareIntegration()
    const result = await fsq.testConnection({ apiKey: '' })
    expect(result.success).toBe(false)
  })
})
