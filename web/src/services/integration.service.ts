import { ref } from 'vue'
import type {
  IntegrationCapability,
  IntegrationRecord,
  IntegrationDefinition,
} from '@server/types/integration.types'
import {
  IntegrationCapabilityId,
  IntegrationId,
} from '@server/types/integration.types'
import { api } from '@/lib/api'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { useLayersStore } from '@/stores/layers.store'

function hasMapLayerCapability(
  integration?:
    | IntegrationRecord
    | { capabilities?: { id: IntegrationCapabilityId; active: boolean }[] },
) {
  const caps = integration?.capabilities || []
  return caps.some(c => c.id === IntegrationCapabilityId.MAP_LAYER)
}

export function useIntegrationService() {
  const store = useIntegrationsStore()
  const layersStore = useLayersStore()
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  async function refreshLayersIfNeeded(integrationId?: string) {
    try {
      // Reload layers if the integration involved can affect map layers
      const justUpdated = store.integrationConfigurations.find(
        i => i.integrationId === integrationId,
      )
      if (!integrationId || hasMapLayerCapability(justUpdated)) {
        await layersStore.loadLayers()
      }
    } catch (e) {}
  }

  async function createIntegration(
    integrationId: string,
    config: Record<string, any>,
    capabilities?: IntegrationCapability[],
  ) {
    isLoading.value = true
    error.value = null

    const requestData: any = {
      integrationId,
      config,
    }

    if (capabilities) {
      requestData.capabilities = capabilities
    }

    const response = await api.post('/integrations', requestData)

    await fetchConfiguredIntegrations()
    await refreshLayersIfNeeded(integrationId)
    return response.data
  }

  async function updateIntegration(
    id: string,
    updates: {
      config?: Record<string, any>
      capabilities?: IntegrationCapability[]
    },
  ) {
    isLoading.value = true
    error.value = null

    const response = await api.put(`/integrations/${id}`, updates)

    await fetchConfiguredIntegrations()
    const updated = store.integrationConfigurations.find(i => i.id === id)
    await refreshLayersIfNeeded(updated?.integrationId)
    return response.data
  }

  async function deleteIntegration(id: IntegrationRecord['id']) {
    isLoading.value = true
    error.value = null

    const deleted = store.integrationConfigurations.find(i => i.id === id)

    await api.delete(`/integrations/${id}`)

    await fetchConfiguredIntegrations()
    await refreshLayersIfNeeded(deleted?.integrationId)
    isLoading.value = false

    return true
  }

  async function testIntegrationConfig(
    integrationId: string,
    config: Record<string, any>,
  ) {
    isLoading.value = true
    error.value = null

    const response = await api.post('/integrations/test', {
      integrationId,
      config,
    })

    isLoading.value = false
    return response.data
  }

  async function toggleIntegrationEnabled(id: string, enabled: boolean) {
    const integration = store.integrationConfigurations.find(i => i.id === id)
    if (!integration) return

    const updatedCapabilities = integration.capabilities.map(cap => ({
      ...cap,
      active: enabled,
    }))

    const result = await updateIntegration(id, {
      capabilities: updatedCapabilities,
    })
    return result
  }

  async function toggleCapability(
    id: string,
    capabilityId: IntegrationCapabilityId,
    active: boolean,
  ) {
    const integration = store.integrationConfigurations.find(i => i.id === id)
    if (!integration) return

    const updatedCapabilities = integration.capabilities.map(cap =>
      cap.id === capabilityId ? { ...cap, active } : cap,
    )

    const result = await updateIntegration(id, {
      capabilities: updatedCapabilities,
    })
    return result
  }

  async function fetchAvailableIntegrations() {
    store.isLoadingAvailable = true
    try {
      const response = await api.get<IntegrationDefinition[]>(
        '/integrations/available',
      )
      store.availableIntegrations = response.data
      return response.data
    } finally {
      store.isLoadingAvailable = false
    }
  }

  async function fetchConfiguredIntegrations() {
    store.isLoadingConfigured = true
    try {
      const response = await api.get<IntegrationRecord[]>(
        '/integrations/configured',
      )
      store.integrationConfigurations = response.data
      return response.data
    } finally {
      store.isLoadingConfigured = false
    }
  }

  return {
    isLoading,
    error,
    createIntegration,
    updateIntegration,
    deleteIntegration,
    testIntegrationConfig,
    toggleIntegrationEnabled,
    toggleCapability,
    fetchAvailableIntegrations,
    fetchConfiguredIntegrations,
  }
}
