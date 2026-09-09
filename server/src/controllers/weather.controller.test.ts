/**
 * Endpoint tests for the weather controller.
 *
 * Two behaviours carry real risk here and are pinned down below:
 *   - air quality is only ever attached from a real ground station, and an
 *     OpenAQ failure must degrade to "no air quality" rather than fail the
 *     whole forecast;
 *   - a missing or unconfigured weather integration answers 503, not 500.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { createTestApp, req } from '../test/app'

const forecast = () => ({
  temperature: 21,
  conditions: 'Clear',
  airQuality: undefined as unknown,
  aqiComponents: undefined as unknown,
})

const getWeather = mock(async (_lat: number, _lng: number, _lang: string) => forecast())

const weatherIntegration = {
  capabilities: { weather: { getWeather } },
}

let configuredIntegrations: unknown[] = [{ id: 'openweathermap' }]
let cachedInstance: unknown = weatherIntegration

const getConfiguredIntegrationsByCapability = mock(() => configuredIntegrations)
const getCachedIntegrationInstance = mock(() => cachedInstance)

mock.module('../services/integrations', () => ({
  integrationManager: {
    getConfiguredIntegrationsByCapability,
    getCachedIntegrationInstance,
  },
}))

const getNearestStationAirQuality = mock(
  async (_lat: number, _lng: number) =>
    ({ airQuality: { aqi: 42 }, components: { pm25: 8 } }) as unknown,
)

mock.module('../services/air-quality.service', () => ({
  getNearestStationAirQuality,
}))

const weather = (await import('./weather.controller')).default
const app = createTestApp(weather)

beforeEach(() => {
  configuredIntegrations = [{ id: 'openweathermap' }]
  cachedInstance = weatherIntegration
  getWeather.mockClear()
  getWeather.mockImplementation(async () => forecast())
  getNearestStationAirQuality.mockClear()
  getNearestStationAirQuality.mockImplementation(async () => ({
    airQuality: { aqi: 42 },
    components: { pm25: 8 },
  }))
  getConfiguredIntegrationsByCapability.mockClear()
  getCachedIntegrationInstance.mockClear()
})

describe('GET /weather', () => {
  test('returns the forecast for the requested coordinates', async () => {
    const res = await req(app).get('/weather', { query: { lat: 35.2, lng: -80.8 } })

    expect(res.status).toBe(200)
    expect(res.body.temperature).toBe(21)
    expect(getWeather.mock.calls[0][0]).toBe(35.2)
    expect(getWeather.mock.calls[0][1]).toBe(-80.8)
  })

  test('coerces numeric query params rather than passing strings through', async () => {
    await req(app).get('/weather', { query: { lat: '35.2', lng: '-80.8' } })

    expect(typeof getWeather.mock.calls[0][0]).toBe('number')
    expect(typeof getWeather.mock.calls[0][1]).toBe('number')
  })

  test('passes an explicit lang through to the integration', async () => {
    await req(app).get('/weather', { query: { lat: 1, lng: 2, lang: 'es' } })

    expect(getWeather.mock.calls[0][2]).toBe('es')
  })

  test('falls back to the request language when lang is omitted', async () => {
    await req(app).get('/weather', {
      query: { lat: 1, lng: 2 },
      headers: { 'accept-language': 'es-ES' },
    })

    expect(getWeather.mock.calls[0][2]).toBe('es')
  })

  test('is public — no authentication required', async () => {
    const res = await req(app).get('/weather', { query: { lat: 1, lng: 2 } })

    expect(res.status).toBe(200)
  })
})

describe('GET /weather — query validation', () => {
  // NOTE: the handler also has a `lat === undefined` → 400 branch, but
  // `t.Numeric()` makes both params required, so validation answers 422 first
  // and that branch is unreachable.
  test('422s when lat is missing', async () => {
    const res = await req(app).get('/weather', { query: { lng: -80.8 } })

    expect(res.status).toBe(422)
    expect(getWeather).not.toHaveBeenCalled()
  })

  test('422s when lng is missing', async () => {
    const res = await req(app).get('/weather', { query: { lat: 35.2 } })

    expect(res.status).toBe(422)
    expect(getWeather).not.toHaveBeenCalled()
  })

  test('422s on a non-numeric coordinate', async () => {
    const res = await req(app).get('/weather', { query: { lat: 'north', lng: -80.8 } })

    expect(res.status).toBe(422)
    expect(getWeather).not.toHaveBeenCalled()
  })
})

describe('GET /weather — air quality attachment', () => {
  test('attaches air quality from the nearest ground station', async () => {
    const res = await req(app).get('/weather', { query: { lat: 35.2, lng: -80.8 } })

    expect(res.body.airQuality).toEqual({ aqi: 42 })
    expect(res.body.aqiComponents).toEqual({ pm25: 8 })
    expect(getNearestStationAirQuality).toHaveBeenCalledWith(35.2, -80.8)
  })

  test('omits air quality when no station is in range', async () => {
    getNearestStationAirQuality.mockResolvedValueOnce(null)

    const res = await req(app).get('/weather', { query: { lat: 1, lng: 2 } })

    expect(res.status).toBe(200)
    expect(res.body.airQuality).toBeUndefined()
  })

  test('still returns the forecast when the OpenAQ lookup throws', async () => {
    // A modeled estimate would be worse than nothing here, so the failure is
    // swallowed and the forecast is served without air quality.
    getNearestStationAirQuality.mockRejectedValueOnce(new Error('OpenAQ down'))

    const res = await req(app).get('/weather', { query: { lat: 1, lng: 2 } })

    expect(res.status).toBe(200)
    expect(res.body.temperature).toBe(21)
    expect(res.body.airQuality).toBeUndefined()
  })
})

describe('GET /weather — integration availability', () => {
  test('503s when no weather integration is configured', async () => {
    configuredIntegrations = []

    const res = await req(app).get('/weather', { query: { lat: 1, lng: 2 } })

    expect(res.status).toBe(503)
    expect(getWeather).not.toHaveBeenCalled()
  })

  test('503s when the configured integration has no cached instance', async () => {
    cachedInstance = null

    const res = await req(app).get('/weather', { query: { lat: 1, lng: 2 } })

    expect(res.status).toBe(503)
  })

  test('503s when the instance lacks the weather capability', async () => {
    cachedInstance = { capabilities: {} }

    const res = await req(app).get('/weather', { query: { lat: 1, lng: 2 } })

    expect(res.status).toBe(503)
  })

  test('500s with the upstream message when the provider throws', async () => {
    getWeather.mockRejectedValueOnce(new Error('upstream exploded'))

    const res = await req(app).get('/weather', { query: { lat: 1, lng: 2 } })

    expect(res.status).toBe(500)
    expect(res.body.message).toBe('upstream exploded')
  })
})
