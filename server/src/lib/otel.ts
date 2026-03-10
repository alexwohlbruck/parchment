/**
 * OpenTelemetry SDK bootstrap.
 * Call initOtel(config) once at app startup (after resolving observability config).
 * Config can come from env (OTEL_*) or from the Axiom system integration.
 */
import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions'
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-node'
import type { ObservabilityConfig } from '../services/observability.config'

let sdk: NodeSDK
let initialized = false

export async function initOtel(config: ObservabilityConfig | null): Promise<void> {
  if (initialized) return
  initialized = true

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]:
      config?.serviceName ?? process.env.OTEL_SERVICE_NAME ?? 'parchment',
    [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? '0.0.0',
    'deployment.environment': process.env.NODE_ENV ?? 'development',
  })

  const enableExport = config != null && config.endpoint?.trim().length > 0

  sdk = new NodeSDK({
    resource,
    ...(enableExport && {
      spanProcessors: [
        new BatchSpanProcessor(
          new OTLPTraceExporter({
            url: `${config!.endpoint.replace(/\/$/, '')}/v1/traces`,
            headers: parseHeaders(config!.headers),
          }),
        ),
      ],
      logRecordProcessors: [
        new BatchLogRecordProcessor(
          new OTLPLogExporter({
            url: `${config!.endpoint.replace(/\/$/, '')}/v1/logs`,
            headers: parseHeaders(config!.headers),
          }),
        ),
      ],
    }),
  })

  sdk.start()

  const shutdown = () => sdk.shutdown().finally(() => process.exit(0))
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

function parseHeaders(headerString: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!headerString?.trim()) return out
  for (const part of headerString.split(',')) {
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    const key = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (key && value) out[key] = value
  }
  return out
}
