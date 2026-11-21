import { describe, expect, mock, test } from 'bun:test'
import type { AskContext } from './ask-tool-base'

const square = (lng: number, lat: number, size: number) => ({
  type: 'Polygon',
  coordinates: [
    [
      [lng - size, lat - size],
      [lng + size, lat - size],
      [lng + size, lat + size],
      [lng - size, lat + size],
      [lng - size, lat - size],
    ],
  ],
})
const collection = (features: unknown[]) => ({ type: 'FeatureCollection', features })

mock.module('../wildfire.service', () => ({
  isFirmsConfigured: () => true,
  getFirePerimeters: async () =>
    collection([
      {
        type: 'Feature',
        geometry: square(-120.3, 39.2, 0.05),
        properties: {
          attr_IncidentName: 'Far Fire',
          poly_GISAcres: 1200.4,
          attr_PercentContained: 40,
          attr_FireDiscoveryDateTime: Date.UTC(2026, 10, 18),
        },
      },
      { type: 'Feature', geometry: square(-120, 39, 0.02), properties: { poly_IncidentName: 'Near Fire' } },
      { type: 'Feature', geometry: square(-110, 39, 0.02), properties: { poly_IncidentName: 'Out of range' } },
    ]),
  getFireHotspots: async () =>
    collection([
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-120.05, 39] }, properties: {} },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-100, 39] }, properties: {} },
    ]),
  getSmokePlumes: async () =>
    collection([
      { type: 'Feature', geometry: square(-120, 39, 1), properties: { Density: 'Light' } },
      { type: 'Feature', geometry: square(-120, 39, 0.5), properties: { Density: 'Medium' } },
    ]),
}))
mock.module('../geocoding.service', () => ({
  forwardGeocode: async () => ({ results: [] }),
  reverseGeocode: async () => ({ results: [] }),
}))
mock.module('../place.service', () => ({ lookupEnrichedPlaceById: async () => null }))

const { environmentTools } = await import('./ask-environment-tools')
const wildfires = environmentTools.find((tool) => tool.name === 'wildfires')!

const context = {
  userId: 'u1',
  language: 'en-US',
  origin: { lat: 39, lng: -120 },
  places: new Map(),
  units: 'metric',
  vehicles: [],
  now: new Date('2026-11-20T15:00:00Z'),
  seen: new Map(),
  routes: new Map(),
  sources: new Map(),
  emit: () => {},
} as AskContext

describe('wildfires', () => {
  test('lists named fires nearest first, counts detections in range and reports the thickest smoke overhead', async () => {
    const result = (await wildfires.run({}, context)) as any
    expect(result.named_fires.map((fire: any) => fire.name)).toEqual(['Near Fire', 'Far Fire'])
    expect(result.named_fires[0].distance).toBe('here')
    expect(result.named_fires[1]).toMatchObject({ acres: 1200, contained_percent: 40, since: '2026-11-18' })
    expect(result.satellite_detections).toBe(1)
    expect(result.smoke_overhead).toBe('Medium')
  })
})
