import { api } from '@/lib/api'
import { useIntegrationsStore } from '@/stores/integrations.store'
import type { LocationHistory } from '@server/types/location-history.types'

export class MissingDawarichConfigError extends Error {
  constructor() {
    super('Dawarich is not configured')
    this.name = 'MissingDawarichConfigError'
  }
}

export interface FetchLocationHistoryArgs {
  start: Date
  end: Date
  /** IANA timezone for daily-stats bucketing. Defaults to the browser's. */
  timezone?: string
  /** Pass an AbortController.signal to cancel a stale request. */
  signal?: AbortSignal
}

/**
 * Fetch unified location history for a date range.
 *
 * The Dawarich config is decrypted client-side at sign-in (user-e2ee scheme),
 * so the URL + token live only in memory. They're forwarded to our server via
 * `X-Integration-Endpoint` and `X-Integration-Token` headers per request; our
 * server uses them in-memory to call Dawarich and never persists or logs them.
 */
export async function fetchLocationHistory(
  args: FetchLocationHistoryArgs,
): Promise<LocationHistory> {
  const integrationsStore = useIntegrationsStore()
  const config = integrationsStore.dawarichConfig
  if (!config) throw new MissingDawarichConfigError()

  const timezone =
    args.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'

  const response = await api.get<LocationHistory>('/location-history', {
    params: {
      start: args.start.toISOString(),
      end: args.end.toISOString(),
      timezone,
    },
    headers: {
      'X-Integration-Endpoint': config.url,
      'X-Integration-Token': config.apiToken,
    },
    signal: args.signal,
  })

  return response.data
}
