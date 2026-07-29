/**
 * Unit tests for observability config resolution.
 *
 * Two sources feed the OTLP exporters: `OTEL_*` env vars and the Axiom system
 * integration stored in the database. Env wins outright — an operator setting
 * env vars must not have them quietly overridden by whatever is in the DB — and
 * when env is present the DB is not even consulted.
 *
 * The DB path is where the false-positive risk lives: an Axiom integration row
 * can exist while its token or dataset is blank (created but never filled in),
 * and treating that as configured produces exporters that fail silently on
 * every log. Whitespace-only values count as blank for the same reason.
 *
 * `refreshObservability` must never throw: it runs on integration
 * create/update/delete, and a logging-config failure must not fail the
 * integration write that triggered it.
 */

import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'

const getConfiguredIntegrations = mock(async () => [] as any[])
const setObservabilityConfig = mock((_config: unknown) => true)

mock.module('./integration.service', () => ({ getConfiguredIntegrations }))
mock.module('../lib/otel', () => ({ setObservabilityConfig }))
mock.module('../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
}))

const { getObservabilityConfig, refreshObservability } = await import(
  './observability.config'
)

const axiomRow = (config: Record<string, unknown> | null) => ({
  integrationId: 'axiom',
  config,
})

const OTEL_KEYS = [
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_HEADERS',
  'OTEL_SERVICE_NAME',
] as const

const savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of OTEL_KEYS) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
  getConfiguredIntegrations.mockReset()
  getConfiguredIntegrations.mockResolvedValue([])
  setObservabilityConfig.mockClear()
})

afterEach(() => {
  for (const key of OTEL_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]!
  }
})

describe('environment configuration', () => {
  test('uses the OTLP endpoint and headers from the environment', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://otlp.example.com'
    process.env.OTEL_EXPORTER_OTLP_HEADERS = 'Authorization=Bearer abc'

    expect(await getObservabilityConfig()).toEqual({
      endpoint: 'https://otlp.example.com',
      headers: 'Authorization=Bearer abc',
      serviceName: undefined,
    })
  })

  test('does not consult the database when env is set', async () => {
    // Explicit operator configuration must not be second-guessed.
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://otlp.example.com'

    await getObservabilityConfig()

    expect(getConfiguredIntegrations).not.toHaveBeenCalled()
  })

  test('defaults the headers to empty when only an endpoint is set', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://otlp.example.com'

    expect((await getObservabilityConfig())!.headers).toBe('')
  })

  test('trims the endpoint', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = '  https://otlp.example.com  '

    expect((await getObservabilityConfig())!.endpoint).toBe(
      'https://otlp.example.com',
    )
  })

  test('carries the service name through', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://otlp.example.com'
    process.env.OTEL_SERVICE_NAME = 'parchment-server'

    expect((await getObservabilityConfig())!.serviceName).toBe('parchment-server')
  })

  test('falls through to the database for a blank endpoint', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = '   '

    await getObservabilityConfig()

    expect(getConfiguredIntegrations).toHaveBeenCalled()
  })
})

describe('Axiom integration configuration', () => {
  test('builds the endpoint and headers from the stored config', async () => {
    getConfiguredIntegrations.mockResolvedValue([
      axiomRow({ apiToken: 'xaat-123', dataset: 'parchment' }),
    ])

    expect(await getObservabilityConfig()).toEqual({
      endpoint: 'https://api.axiom.co',
      headers: 'Authorization=Bearer xaat-123,X-Axiom-Dataset=parchment',
      serviceName: undefined,
    })
  })

  test('honours a custom Axiom endpoint', async () => {
    getConfiguredIntegrations.mockResolvedValue([
      axiomRow({
        endpoint: 'https://api.eu.axiom.co',
        apiToken: 'xaat-123',
        dataset: 'parchment',
      }),
    ])

    expect((await getObservabilityConfig())!.endpoint).toBe(
      'https://api.eu.axiom.co',
    )
  })

  test('strips a trailing slash from the endpoint', async () => {
    getConfiguredIntegrations.mockResolvedValue([
      axiomRow({
        endpoint: 'https://api.axiom.co/',
        apiToken: 'xaat-123',
        dataset: 'parchment',
      }),
    ])

    expect((await getObservabilityConfig())!.endpoint).toBe('https://api.axiom.co')
  })

  test('trims the token and dataset before building headers', async () => {
    getConfiguredIntegrations.mockResolvedValue([
      axiomRow({ apiToken: '  xaat-123  ', dataset: '  parchment  ' }),
    ])

    expect((await getObservabilityConfig())!.headers).toBe(
      'Authorization=Bearer xaat-123,X-Axiom-Dataset=parchment',
    )
  })

  test('ignores integrations other than Axiom', async () => {
    getConfiguredIntegrations.mockResolvedValue([
      { integrationId: 'mapbox', config: { apiKey: 'pk.abc' } },
    ])

    expect(await getObservabilityConfig()).toBeNull()
  })

  test('picks Axiom out of a list of system integrations', async () => {
    getConfiguredIntegrations.mockResolvedValue([
      { integrationId: 'mapbox', config: { apiKey: 'pk.abc' } },
      axiomRow({ apiToken: 'xaat-123', dataset: 'parchment' }),
    ])

    expect(await getObservabilityConfig()).not.toBeNull()
  })
})

describe('incomplete configuration', () => {
  test('reports nothing configured when there are no integrations', async () => {
    expect(await getObservabilityConfig()).toBeNull()
  })

  test('reports nothing for an Axiom row with no config', async () => {
    getConfiguredIntegrations.mockResolvedValue([axiomRow(null)])

    expect(await getObservabilityConfig()).toBeNull()
  })

  test('reports nothing when the token is missing', async () => {
    // Half-configured must not produce exporters that fail on every log.
    getConfiguredIntegrations.mockResolvedValue([
      axiomRow({ dataset: 'parchment' }),
    ])

    expect(await getObservabilityConfig()).toBeNull()
  })

  test('reports nothing when the dataset is missing', async () => {
    getConfiguredIntegrations.mockResolvedValue([axiomRow({ apiToken: 'xaat-1' })])

    expect(await getObservabilityConfig()).toBeNull()
  })

  test('treats whitespace-only values as unset', async () => {
    getConfiguredIntegrations.mockResolvedValue([
      axiomRow({ apiToken: '   ', dataset: 'parchment' }),
    ])

    expect(await getObservabilityConfig()).toBeNull()
  })
})

describe('refreshObservability', () => {
  test('applies the resolved config to the live exporters', async () => {
    getConfiguredIntegrations.mockResolvedValue([
      axiomRow({ apiToken: 'xaat-123', dataset: 'parchment' }),
    ])

    await refreshObservability()

    expect(setObservabilityConfig).toHaveBeenCalledWith({
      endpoint: 'https://api.axiom.co',
      headers: 'Authorization=Bearer xaat-123,X-Axiom-Dataset=parchment',
      serviceName: undefined,
    })
  })

  test('clears the exporters when nothing is configured', async () => {
    // Disabling the integration has to turn export off, not leave it running.
    await refreshObservability()

    expect(setObservabilityConfig).toHaveBeenCalledWith(null)
  })

  test('swallows a resolution failure', async () => {
    // It runs inside integration writes; a logging failure must not fail them.
    getConfiguredIntegrations.mockRejectedValue(new Error('db down'))

    await expect(refreshObservability()).resolves.toBeUndefined()
    expect(setObservabilityConfig).not.toHaveBeenCalled()
  })

  test('swallows a failure from the exporter itself', async () => {
    setObservabilityConfig.mockImplementationOnce(() => {
      throw new Error('exporter blew up')
    })

    await expect(refreshObservability()).resolves.toBeUndefined()
  })
})
