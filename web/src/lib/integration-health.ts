import { useStorage } from '@vueuse/core'
import { jsonSerializer } from '@/lib/storage-serializer'

/**
 * Client-side health for third-party integrations, keyed by integration id.
 * Lives in lib (like connectivity) so the axios interceptor can update it:
 * requests tagged with `integrationId` mark their integration degraded on an
 * upstream failure and clear it on success. Settings surfaces the flag as a
 * repair badge. Persisted per device — health of a user's own endpoints
 * (e.g. a self-hosted Dawarich) isn't server state.
 */
export const degradedIntegrations = useStorage<Record<string, string>>(
  'degraded-integrations',
  {},
  undefined,
  { serializer: jsonSerializer },
)

/** Statuses our API returns when the upstream integration service failed. */
export const INTEGRATION_FAILURE_STATUSES = [502, 503]

export function markIntegrationDegraded(
  integrationId: string,
  message?: string,
) {
  degradedIntegrations.value = {
    ...degradedIntegrations.value,
    [integrationId]: message ?? '',
  }
}

export function clearIntegrationDegraded(integrationId: string) {
  if (!(integrationId in degradedIntegrations.value)) return
  const { [integrationId]: _, ...rest } = degradedIntegrations.value
  degradedIntegrations.value = rest
}

export function isIntegrationDegraded(integrationId: string): boolean {
  return integrationId in degradedIntegrations.value
}

export function clearAllIntegrationHealth() {
  degradedIntegrations.value = {}
}
