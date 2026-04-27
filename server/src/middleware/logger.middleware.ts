import { Elysia } from 'elysia'
import {
  trace,
  propagation,
  context as otelContext,
  SpanStatusCode,
  SpanKind,
  type Span,
} from '@opentelemetry/api'
import { emitLogRecord } from '../lib/logger'

const MAX_BODY_LOG_SIZE = 4096

/** Requests slower than this (ms) are sent to OTLP even if successful. */
const SLOW_REQUEST_THRESHOLD_MS = 3000

/** Keys that must never appear in logged response/request bodies. All lowercase so lookup via key.toLowerCase() matches. */
const SENSITIVE_KEYS = new Set([
  'password', 'token', 'secret', 'apikey', 'api_key', 'accesstoken',
  'access_token', 'refreshtoken', 'refresh_token', 'sessionid', 'session_id',
  'authorization', 'cookie', 'set-cookie',
  // Per-request integration credentials (e.g. Dawarich endpoint + token).
  // Both the endpoint URL and the bearer token are user-e2ee material that
  // must never reach a log line, even if a future change starts logging headers.
  'x-integration-endpoint', 'x-integration-token',
  'integrationcredentials', 'integration_credentials',
])

export interface LogEvent {
  request_id: string
  http: {
    method: string
    path: string
    route?: string
    status?: number
    duration_ms?: number
    user_agent?: string
    ip?: string
  }
  /** Request metadata. Handlers may set `logEvent.request.body` to include the request body. */
  request?: {
    method: string
    path: string
    url: string
    query?: Record<string, string>
    body?: unknown
  }
  /**
   * Response metadata. Status is set automatically by middleware.
   * Handlers may set `logEvent.response.body` to include response data in failure logs.
   */
  response?: {
    status: number
    body?: unknown
  }
  user?: {
    id: string
    username?: string
    [key: string]: unknown
  }
  error?: {
    type: string
    message: string
    code?: string
    stack?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

interface LogEventMeta {
  startTime: number
  span: Span
  logged: boolean
}

/** Obtain tracer lazily so we use the SDK's TracerProvider (set in initOtel) rather than the no-op default at load time. */
function getTracer() {
  return trace.getTracer('parchment')
}

function truncateForLog(value: unknown): unknown {
  if (value === null || value === undefined) return value
  const str = typeof value === 'string' ? value : JSON.stringify(value)
  if (str.length <= MAX_BODY_LOG_SIZE) return value
  return str.slice(0, MAX_BODY_LOG_SIZE) + '... [truncated]'
}

function redactSensitiveKeys(obj: unknown, depth = 0): unknown {
  if (depth > 5 || obj === null || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(item => redactSensitiveKeys(item, depth + 1))
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    result[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? '[redacted]' : redactSensitiveKeys(value, depth + 1)
  }
  return result
}

/** Build the log payload: strip internal `_meta`, redact sensitive keys, truncate large bodies. */
function payloadFromLogEvent(logEvent: LogEvent): Record<string, unknown> {
  const { _meta, ...rest } = logEvent as LogEvent & { _meta?: unknown }
  const payload = { ...rest } as Record<string, unknown>

  if (payload.request && typeof payload.request === 'object') {
    const req = payload.request as { body?: unknown; [k: string]: unknown }
    payload.request = {
      ...req,
      ...(req.body !== undefined && { body: truncateForLog(redactSensitiveKeys(req.body)) }),
    }
  }

  if (payload.response && typeof payload.response === 'object') {
    const res = payload.response as { body?: unknown; [k: string]: unknown }
    payload.response = {
      ...res,
      ...(res.body !== undefined && { body: truncateForLog(redactSensitiveKeys(res.body)) }),
    }
  }

  return payload
}

/**
 * Elysia plugin implementing the "wide event" / canonical log line pattern.
 *
 * - Every request is logged to stdout (pino).
 * - Only failed (status >= 400) or slow (> SLOW_REQUEST_THRESHOLD_MS) requests are sent to OTLP.
 * - Response body is NOT auto-logged. Handlers can set `logEvent.response.body` explicitly.
 * - Handlers can set `logEvent.request.body` to include the request body in failure logs.
 * - Incoming `traceparent`/`tracestate` headers are respected for distributed tracing.
 * - `X-Request-Id` is returned in every response for client-side correlation.
 */
export const loggerMiddleware = new Elysia({ name: 'parchment-logger' })
  .derive({ as: 'global' }, ({ request, set }) => {
    const url = new URL(request.url)
    const requestId = `req_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
    const query: Record<string, string> = {}
    url.searchParams.forEach((v, k) => { query[k] = v })

    // Expose request ID to clients for log correlation
    set.headers['x-request-id'] = requestId

    const logEvent: LogEvent = {
      request_id: requestId,
      http: {
        method: request.method,
        path: url.pathname,
        user_agent: request.headers.get('user-agent') ?? undefined,
        ip:
          request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
          request.headers.get('x-real-ip') ??
          undefined,
      },
      request: {
        method: request.method,
        path: url.pathname,
        url: url.href,
        ...(Object.keys(query).length > 0 && { query }),
      },
    }

    // Extract incoming trace context (traceparent/tracestate) so spans are
    // parented to any upstream trace from an API gateway or client.
    const incomingHeaders: Record<string, string> = {}
    request.headers.forEach((value, key) => { incomingHeaders[key] = value })
    const parentCtx = propagation.extract(otelContext.active(), incomingHeaders)

    const span = getTracer().startSpan(
      `${request.method} ${url.pathname}`,
      {
        kind: SpanKind.SERVER,
        attributes: {
          'http.method': request.method,
          'http.url': url.href,
          'http.route': url.pathname,
          'http.user_agent': request.headers.get('user-agent') ?? '',
          'http.request_id': requestId,
        },
      },
      parentCtx,
    )

    const meta: LogEventMeta = { startTime: Date.now(), span, logged: false }
    Object.defineProperty(logEvent, '_meta', { value: meta, enumerable: false })

    return { logEvent }
  })

  .onAfterHandle({ as: 'global' }, ({ logEvent, set }) => {
    if (!logEvent) return
    const meta = (logEvent as LogEvent & { _meta: LogEventMeta })._meta
    if (meta.logged) return
    meta.logged = true

    const status = typeof set.status === 'number' ? set.status : 200
    const duration_ms = Date.now() - meta.startTime

    logEvent.http.status = status
    logEvent.http.duration_ms = duration_ms
    logEvent.response = { ...logEvent.response, status }

    meta.span.setAttribute('http.status_code', status)
    meta.span.setAttribute('http.duration_ms', duration_ms)
    meta.span.setStatus({ code: status >= 500 ? SpanStatusCode.ERROR : SpanStatusCode.OK })
    meta.span.end()

    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info'
    const isFailure = status >= 400
    const isSlow = duration_ms > SLOW_REQUEST_THRESHOLD_MS
    const payload = payloadFromLogEvent(logEvent)
    emitLogRecord(level, 'request', payload, { sendToOtlp: isFailure || isSlow })
  })

  .onError({ as: 'global' }, ({ logEvent, error, code, set }) => {
    if (!logEvent) return
    const meta = (logEvent as LogEvent & { _meta: LogEventMeta })._meta
    if (meta.logged) return
    meta.logged = true

    const status = typeof set.status === 'number' ? set.status : 500
    const duration_ms = Date.now() - meta.startTime

    logEvent.http.status = status
    logEvent.http.duration_ms = duration_ms
    logEvent.response = { ...logEvent.response, status }
    logEvent.error = {
      type: error instanceof Error ? error.name : String(code),
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof Error && error.stack && { stack: error.stack }),
    }

    meta.span.setAttribute('http.status_code', status)
    meta.span.setAttribute('http.duration_ms', duration_ms)
    meta.span.recordException(error instanceof Error ? error : new Error(String(error)))
    meta.span.setStatus({ code: SpanStatusCode.ERROR, message: logEvent.error.message })
    meta.span.end()

    const payload = payloadFromLogEvent(logEvent)
    emitLogRecord('error', 'request', payload, { sendToOtlp: true })
  })
