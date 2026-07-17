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
    query?: Record<string, string>
  }
  /** Handlers may set `logEvent.request = { body }` to include the request body in failure logs. */
  request?: {
    body?: unknown
  }
  /** Handlers may set `logEvent.response = { body }` to include response data in failure logs. */
  response?: {
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
 * Attach debugging/analytics context to a failing request's log event:
 * the authenticated user's non-sensitive id and the parsed request payload.
 * Device info (user_agent, ip) is already captured on `logEvent.http`.
 *
 * `ctx` is the full Elysia request context; `user` and `body` are populated by
 * downstream derives (auth middleware, body parser) and typed loosely here since
 * they are not part of the logger plugin's own context type. Called only for
 * failures (status >= 400) — successful requests are not logged.
 */
function attachDebugContext(logEvent: LogEvent, ctx: unknown): void {
  const context = ctx as { user?: { id?: unknown }; body?: unknown }

  const userId = context.user?.id
  if (typeof userId === 'string') {
    logEvent.user = { ...(logEvent.user ?? {}), id: userId }
  }

  // Include the parsed request body so errors can be reproduced. Redaction of
  // sensitive keys and truncation happen later in payloadFromLogEvent.
  if (context.body !== undefined && logEvent.request?.body === undefined) {
    logEvent.request = { ...(logEvent.request ?? {}), body: context.body }
  }
}

/**
 * Elysia plugin implementing the "wide event" / canonical log line pattern.
 *
 * Logging is split by destination to keep stdout quiet while preserving analytics:
 * - stdout (pino): ONLY server errors (status >= 500) and unhandled exceptions.
 *   Successful (2xx/3xx) and routine client-error (4xx, e.g. 401 auth rejections)
 *   requests produce no stdout line. Error lines carry full debug context:
 *   stack trace, request payload, non-sensitive user (id) and device (user_agent,
 *   ip) info, timing, request id, and trace correlation.
 * - OTLP (e.g. Axiom): all failures (status >= 400) and slow requests
 *   (> SLOW_REQUEST_THRESHOLD_MS) are exported as structured events for analytics,
 *   even when they are kept out of stdout.
 *
 * Other behavior:
 * - Request payload is auto-attached to failure logs (redacted + truncated).
 * - Response body is NOT auto-logged. Handlers can set `logEvent.response.body`.
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

  .onAfterHandle({ as: 'global' }, (ctx) => {
    const { logEvent, set } = ctx
    if (!logEvent) return
    const meta = (logEvent as LogEvent & { _meta: LogEventMeta })._meta
    if (meta.logged) return
    meta.logged = true

    const status = typeof set.status === 'number' ? set.status : 200
    const duration_ms = Date.now() - meta.startTime

    logEvent.http.status = status
    logEvent.http.duration_ms = duration_ms

    meta.span.setAttribute('http.status_code', status)
    meta.span.setAttribute('http.duration_ms', duration_ms)
    meta.span.setStatus({ code: status >= 500 ? SpanStatusCode.ERROR : SpanStatusCode.OK })
    meta.span.end()

    const isFailure = status >= 400
    const isServerError = status >= 500
    const isSlow = duration_ms > SLOW_REQUEST_THRESHOLD_MS

    // Successful, fast requests are not logged at all.
    if (!isFailure && !isSlow) return

    if (isFailure) attachDebugContext(logEvent, ctx)

    // stdout only for real server errors; 4xx and slow requests go to OTLP only.
    const level = isServerError ? 'error' : status >= 400 ? 'warn' : 'info'
    emitLogRecord(level, 'request', payloadFromLogEvent(logEvent), {
      sendToOtlp: true,
      stdout: isServerError,
    })
  })

  .onError({ as: 'global' }, (ctx) => {
    const { logEvent, error, code, set } = ctx
    if (!logEvent) return
    const meta = (logEvent as LogEvent & { _meta: LogEventMeta })._meta
    if (meta.logged) return
    meta.logged = true

    const status = typeof set.status === 'number' ? set.status : 500
    const duration_ms = Date.now() - meta.startTime

    logEvent.http.status = status
    logEvent.http.duration_ms = duration_ms
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

    attachDebugContext(logEvent, ctx)

    // Real server errors (5xx, incl. the default for thrown exceptions) print to
    // stdout with full detail. Exceptions that map to a 4xx (validation, parse,
    // not-found) are client errors — exported to OTLP only, kept out of stdout.
    const isServerError = status >= 500
    emitLogRecord(isServerError ? 'error' : 'warn', 'request', payloadFromLogEvent(logEvent), {
      sendToOtlp: true,
      stdout: isServerError,
    })
  })
