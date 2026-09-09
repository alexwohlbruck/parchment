import { registerRealtimeHandlers } from '@/lib/realtime/realtime-events'
import { useIntegrationService } from '@/services/integration.service'
import {
  clearIntegrationDegraded,
  markIntegrationDegraded,
} from '@/lib/integration-health'

const integrationId = (payload: unknown): string | undefined =>
  (payload as { integrationId?: string } | undefined)?.integrationId

registerRealtimeHandlers('integrations', {
  'integration:updated': (payload) => {
    const id = integrationId(payload)
    if (id) clearIntegrationDegraded(id)
    void useIntegrationService().fetchConfiguredIntegrations()
  },
  'integration:degraded': (payload) => {
    const id = integrationId(payload)
    if (id) markIntegrationDegraded(id)
  },
  'integration:recovered': (payload) => {
    const id = integrationId(payload)
    if (id) clearIntegrationDegraded(id)
  },
  'realtime:reconnected': () => {
    void useIntegrationService().fetchConfiguredIntegrations()
  },
})
