/**
 * OpenTelemetry SDK bootstrap.
 *
 * Call initOtel(config) once at app startup. The OTLP exporters are ALWAYS
 * attached (wrapped in a DynamicExporter that no-ops until configured), so the
 * export target can be set — or changed — at runtime via setObservabilityConfig
 * without a process restart. This is what lets configuring the Axiom
 * integration in the UI take effect immediately instead of on next boot.
 */
import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions'
import {
  BatchLogRecordProcessor,
  type LogRecordExporter,
  type ReadableLogRecord,
} from '@opentelemetry/sdk-logs'
import {
  BatchSpanProcessor,
  type SpanExporter,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-node'
import { type ExportResult, ExportResultCode } from '@opentelemetry/core'
import type { ObservabilityConfig } from '../services/observability.config'

/**
 * An exporter whose inner OTLP target can be swapped (or cleared) at runtime.
 * When no inner exporter is configured, export() succeeds immediately and drops
 * the batch — so the batch processors never buffer unbounded and never hit the
 * network before a target exists.
 */
class DynamicExporter<T> {
  private inner:
    | { export(items: T[], cb: (r: ExportResult) => void): void; shutdown(): Promise<void> }
    | null = null

  setInner(inner: { export(items: T[], cb: (r: ExportResult) => void): void; shutdown(): Promise<void> }) {
    const previous = this.inner
    this.inner = inner
    previous?.shutdown().catch(() => {})
  }

  clear() {
    const previous = this.inner
    this.inner = null
    previous?.shutdown().catch(() => {})
  }

  export(items: T[], resultCallback: (r: ExportResult) => void): void {
    if (!this.inner) {
      resultCallback({ code: ExportResultCode.SUCCESS })
      return
    }
    this.inner.export(items, resultCallback)
  }

  shutdown(): Promise<void> {
    return this.inner?.shutdown() ?? Promise.resolve()
  }
}

const logExporter = new DynamicExporter<ReadableLogRecord>()
const spanExporter = new DynamicExporter<ReadableSpan>()

let sdk: NodeSDK
let initialized = false
let currentEndpoint: string | null = null

export async function initOtel(config: ObservabilityConfig | null): Promise<void> {
  if (initialized) return
  initialized = true

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]:
      config?.serviceName ?? process.env.OTEL_SERVICE_NAME ?? 'parchment',
    [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? '0.0.0',
    'deployment.environment': process.env.NODE_ENV ?? 'development',
  })

  sdk = new NodeSDK({
    resource,
    spanProcessors: [new BatchSpanProcessor(spanExporter as SpanExporter)],
    logRecordProcessors: [
      new BatchLogRecordProcessor(logExporter as LogRecordExporter),
    ],
  })

  sdk.start()

  // Point the exporters at the resolved target (if any). Later calls to
  // setObservabilityConfig can change or clear it live.
  setObservabilityConfig(config)

  const shutdown = () => sdk.shutdown().finally(() => process.exit(0))
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

/**
 * Set — or change, or clear — the OTLP export target at runtime. Returns true
 * when export is now active. Called at boot and again whenever the Axiom
 * integration is saved/enabled/disabled/deleted, so config changes apply
 * without a restart.
 */
export function setObservabilityConfig(config: ObservabilityConfig | null): boolean {
  const endpoint = config?.endpoint?.trim()
  if (!endpoint) {
    if (currentEndpoint) {
      logExporter.clear()
      spanExporter.clear()
      currentEndpoint = null
    }
    return false
  }

  const base = endpoint.replace(/\/$/, '')
  const headers = parseHeaders(config!.headers)
  logExporter.setInner(new OTLPLogExporter({ url: `${base}/v1/logs`, headers }))
  spanExporter.setInner(new OTLPTraceExporter({ url: `${base}/v1/traces`, headers }))
  currentEndpoint = base
  return true
}

/**
 * Force-flush pending log/span batches to the OTLP exporter. Called from the
 * uncaughtException handler before the process exits so the fatal record
 * actually reaches Axiom instead of dying in the batch buffer.
 */
export async function flushOtel(): Promise<void> {
  if (!initialized || !sdk) return
  try {
    await sdk.shutdown()
  } catch {
    // Best-effort: we're already crashing, don't mask the original error.
  }
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
