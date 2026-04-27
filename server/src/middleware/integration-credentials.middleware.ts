import { Elysia } from 'elysia'
import type { IntegrationCredentials } from '../types/integration.types'

/** Header carrying the upstream base URL for an e2ee-scheme capability call. */
export const INTEGRATION_ENDPOINT_HEADER = 'x-integration-endpoint'
/** Header carrying the upstream API token for an e2ee-scheme capability call. */
export const INTEGRATION_TOKEN_HEADER = 'x-integration-token'

const HTTPS_OR_HTTP = /^https?:\/\//i

/**
 * Elysia middleware: validate `X-Integration-Endpoint` + `X-Integration-Token`
 * headers and attach `integrationCredentials` to the request context.
 *
 * Used by capabilities backed by `scheme: 'user-e2ee'` integrations, where the
 * server has no cleartext config at rest. Credentials live in memory only for
 * the duration of the request, are never persisted, and are excluded from the
 * canonical request log via the SENSITIVE_HEADERS set in logger.middleware.
 *
 * Returns 400 if either header is missing, or the endpoint isn't a valid URL.
 */
export const requireIntegrationCredentials = (app: Elysia) =>
  app.derive(
    async ({
      request,
      status,
      t,
    }): Promise<{ integrationCredentials: IntegrationCredentials }> => {
      const endpoint = request.headers.get(INTEGRATION_ENDPOINT_HEADER)?.trim()
      const token = request.headers.get(INTEGRATION_TOKEN_HEADER)?.trim()

      if (!endpoint || !token) {
        return status(400, {
          message: t('errors.integration.credentialsMissing'),
        }) as never
      }

      if (!HTTPS_OR_HTTP.test(endpoint)) {
        return status(400, {
          message: t('errors.integration.endpointInvalid'),
        }) as never
      }

      try {
        new URL(endpoint)
      } catch {
        return status(400, {
          message: t('errors.integration.endpointInvalid'),
        }) as never
      }

      return { integrationCredentials: { endpoint, token } }
    },
  )
