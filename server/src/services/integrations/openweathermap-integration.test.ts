/**
 * Unit tests for the OpenWeatherMap integration.
 *
 * The adapter turns OWM's Current Weather 2.5 payload into our `WeatherData`
 * shape. Two details matter: temperatures are ROUNDED (the UI shows whole
 * degrees), and the epoch-second timestamps have to be multiplied by 1000
 * before becoming ISO strings — getting that wrong dates every reading to 1970.
 *
 * Air quality is deliberately absent here. The weather controller attaches it
 * only from a real OpenAQ ground station; OWM's modeled AQI is not used,
 * because a wrong number is worse than none.
 */

import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test'

const realFetch = globalThis.fetch
let fetchResponse: Response | null = null
let fetchError: Error | null = null
const fetchCalls: string[] = []

globalThis.fetch = mock(async (url: any) => {
  fetchCalls.push(String(url))
  if (fetchError) throw fetchError
  return fetchResponse ?? new Response('{}', { status: 200 })
}) as any

afterAll(() => {
  globalThis.fetch = realFetch
})

mock.module('../../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
  logError: () => {},
  logWarn: () => {},
}))

const { OpenWeatherMapIntegration } = await import('./openweathermap-integration')

function owmResponse(over: Partial<any> = {}) {
  return new Response(
    JSON.stringify({
      name: 'Charlotte',
      weather: [{ main: 'Clouds', description: 'broken clouds', icon: '04d' }],
      main: {
        temp: 21.4,
        feels_like: 20.6,
        temp_min: 18.2,
        temp_max: 24.9,
        humidity: 55,
        pressure: 1013,
      },
      wind: { speed: 3.2, deg: 180 },
      clouds: { all: 75 },
      visibility: 10000,
      dt: 1735689600,
      sys: { sunrise: 1735646400, sunset: 1735682400 },
      ...over,
    }),
    { status: 200 },
  )
}

function configured() {
  const integration = new OpenWeatherMapIntegration()
  integration.initialize({ apiKey: 'owm-key' })
  return integration
}

beforeEach(() => {
  fetchCalls.length = 0
  fetchResponse = null
  fetchError = null
})

describe('configuration', () => {
  test('validates that an API key is present', () => {
    const integration = new OpenWeatherMapIntegration()

    expect(integration.validateConfig({ apiKey: 'key' })).toBe(true)
    expect(integration.validateConfig({ apiKey: '' })).toBe(false)
  })

  test('initialize refuses an empty key', () => {
    expect(() =>
      new OpenWeatherMapIntegration().initialize({ apiKey: '' }),
    ).toThrow('API Key is required')
  })

  test('getWeather refuses to run before initialization', async () => {
    const integration = new OpenWeatherMapIntegration()

    await expect(integration.getWeather(35.2, -80.8)).rejects.toThrow(
      'has not been initialized',
    )
    expect(fetchCalls).toHaveLength(0)
  })

  test('exposes the weather capability', () => {
    expect(new OpenWeatherMapIntegration().capabilityIds).toEqual(['weather'])
    expect(
      typeof new OpenWeatherMapIntegration().capabilities.weather.getWeather,
    ).toBe('function')
  })
})

describe('testConnection', () => {
  test('rejects an empty key without a request', async () => {
    const result = await new OpenWeatherMapIntegration().testConnection({
      apiKey: '',
    })

    expect(result.success).toBe(false)
    expect(fetchCalls).toHaveLength(0)
  })

  test('succeeds against the probe endpoint', async () => {
    fetchResponse = owmResponse()

    expect(
      await new OpenWeatherMapIntegration().testConnection({ apiKey: 'key' }),
    ).toEqual({ success: true })
  })

  test('reports the upstream message on a 401', async () => {
    fetchResponse = new Response(JSON.stringify({ message: 'Invalid API key' }), {
      status: 401,
    })

    const result = await new OpenWeatherMapIntegration().testConnection({
      apiKey: 'bad',
    })

    expect(result).toEqual({ success: false, message: 'Invalid API key' })
  })

  test('falls back to a generic message when the body is not JSON', async () => {
    fetchResponse = new Response('<html>gateway</html>', {
      status: 502,
      statusText: 'Bad Gateway',
    })

    const result = await new OpenWeatherMapIntegration().testConnection({
      apiKey: 'key',
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('Bad Gateway')
  })

  test('surfaces a network failure', async () => {
    fetchError = new Error('ENOTFOUND')

    const result = await new OpenWeatherMapIntegration().testConnection({
      apiKey: 'key',
    })

    expect(result.message).toContain('ENOTFOUND')
  })
})

describe('getWeather', () => {
  test('maps the payload into the unified shape', async () => {
    fetchResponse = owmResponse()

    const weather = await configured().getWeather(35.2, -80.8)

    expect(weather).toMatchObject({
      locationName: 'Charlotte',
      humidity: 55,
      pressure: 1013,
      windSpeed: 3.2,
      windDirection: 180,
      cloudiness: 75,
      visibility: 10000,
      condition: 'Clouds',
      conditionDescription: 'broken clouds',
      conditionIcon: '04d',
    })
  })

  test('rounds temperatures to whole degrees', async () => {
    fetchResponse = owmResponse()

    const weather = await configured().getWeather(35.2, -80.8)

    expect(weather.temperature).toBe(21)
    expect(weather.temperatureFeelsLike).toBe(21)
    expect(weather.temperatureMin).toBe(18)
    expect(weather.temperatureMax).toBe(25)
  })

  test('converts epoch seconds into ISO timestamps', async () => {
    // Forgetting the ×1000 dates every reading to 1970.
    fetchResponse = owmResponse()

    const weather = await configured().getWeather(35.2, -80.8)

    expect(weather.timestamp).toBe('2025-01-01T00:00:00.000Z')
    expect(new Date(weather.sunrise!).getUTCFullYear()).toBe(2024)
  })

  test('omits sunrise and sunset when absent', async () => {
    fetchResponse = owmResponse({ sys: {} })

    const weather = await configured().getWeather(35.2, -80.8)

    expect(weather.sunrise).toBeUndefined()
    expect(weather.sunset).toBeUndefined()
  })

  test('requests metric units', async () => {
    fetchResponse = owmResponse()

    await configured().getWeather(35.2, -80.8)

    expect(fetchCalls[0]).toContain('units=metric')
  })

  test('defaults the language to English', async () => {
    fetchResponse = owmResponse()

    await configured().getWeather(35.2, -80.8)

    expect(fetchCalls[0]).toContain('lang=en')
  })

  test('passes an explicit language through', async () => {
    fetchResponse = owmResponse()

    await configured().getWeather(35.2, -80.8, 'es')

    expect(fetchCalls[0]).toContain('lang=es')
  })

  test('sends the coordinates as lat/lon', async () => {
    fetchResponse = owmResponse()

    await configured().getWeather(35.2, -80.8)

    expect(fetchCalls[0]).toContain('lat=35.2')
    expect(fetchCalls[0]).toContain('lon=-80.8')
  })

  test('never reports air quality — that comes only from OpenAQ', async () => {
    fetchResponse = owmResponse()

    const weather = await configured().getWeather(35.2, -80.8)

    expect((weather as any).airQuality).toBeUndefined()
    // A single request: no air-pollution round-trip.
    expect(fetchCalls).toHaveLength(1)
  })

  test('throws with the upstream message on an API error', async () => {
    fetchResponse = new Response(
      JSON.stringify({ message: 'city not found' }),
      { status: 404 },
    )

    await expect(configured().getWeather(35.2, -80.8)).rejects.toThrow(
      'city not found',
    )
  })

  test('throws a generic message when the error body is unparseable', async () => {
    fetchResponse = new Response('nope', { status: 500, statusText: 'Server Error' })

    await expect(configured().getWeather(35.2, -80.8)).rejects.toThrow(
      'Weather API error',
    )
  })

  test('propagates a network failure', async () => {
    fetchError = new Error('ETIMEDOUT')

    await expect(configured().getWeather(35.2, -80.8)).rejects.toThrow('ETIMEDOUT')
  })
})
