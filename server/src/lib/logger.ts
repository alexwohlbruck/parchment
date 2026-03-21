import pino from 'pino'
import { trace, context } from '@opentelemetry/api'
import { logs, SeverityNumber } from '@opentelemetry/api-logs'

const isDev = process.env.NODE_ENV !== 'production'

/**
 * Inject active OTel span context into every pino log record so logs
 * are automatically correlated with their parent trace/span.
 */
function otelMixin() {
  const span = trace.getActiveSpan()
  if (!span) return {}
  const { traceId, spanId, traceFlags } = span.spanContext()
  return { trace_id: traceId, span_id: spanId, trace_flags: traceFlags }
}

export const logger = pino({
  level: process.env.OTEL_LOG_LEVEL ?? 'info',
  mixin: otelMixin,
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
    },
  }),
})

/**
 * OTel logger for emitting to the OTLP endpoint. Obtained lazily so we use the
 * SDK's LoggerProvider (set in initOtel) rather than the no-op default at load time.
 */
function getOtelLogger() {
  return logs.getLogger('parchment')
}

const pinoToSeverity: Record<string, SeverityNumber> = {
  trace: SeverityNumber.TRACE,
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
  fatal: SeverityNumber.FATAL,
}

export interface EmitLogRecordOptions {
  /** When false, only log to pino (stdout). When true, also send to OTLP (e.g. Axiom). Default true. */
  sendToOtlp?: boolean
}

/**
 * Emit a structured log record to pino (stdout). Optionally also send to the OTLP pipeline.
 * Use this for canonical/wide event log lines — NOT for per-line debug output.
 */
export function emitLogRecord(
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal',
  message: string,
  attributes: Record<string, unknown> = {},
  options: EmitLogRecordOptions = {},
) {
  const { sendToOtlp = true } = options

  logger[level](attributes, message)

  if (sendToOtlp) {
    getOtelLogger().emit({
      severityNumber: pinoToSeverity[level],
      severityText: level.toUpperCase(),
      body: message,
      attributes: flattenAttributes(attributes),
      context: context.active(),
    })
  }
}

/**
 * OTel log attributes must be primitives or arrays of primitives.
 * Flatten nested objects to dot-notation strings for compatibility.
 */
function flattenAttributes(
  obj: Record<string, unknown>,
  prefix = '',
): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (value === null || value === undefined) continue
    if (typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenAttributes(value as Record<string, unknown>, fullKey))
    } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[fullKey] = value
    } else {
      result[fullKey] = String(value)
    }
  }
  return result
}
