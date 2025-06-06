import { ref } from 'vue'
import type {
  IntegrationCapability,
  IntegrationResponse,
} from '@server/types/integration.types'
import {
  IntegrationCapabilityId,
  IntegrationId,
} from '@server/types/integration.types'
import { api } from '@/lib/api'
import { useIntegrationsStore } from '@/stores/integrations.store'

export function useIntegrationService() {
  const store = useIntegrationsStore()
  const isLoading = ref(false)
  const error = ref<string | null>(null)

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

    await store.fetchConfiguredIntegrations()
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

    await store.fetchConfiguredIntegrations()
    return response.data
  }

  async function deleteIntegration(id: IntegrationResponse['id']) {
    isLoading.value = true
    error.value = null

    await api.delete(`/integrations/${id}`)

    await store.fetchConfiguredIntegrations()
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
    const integration = store.configuredIntegrations.find(i => i.id === id)
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
    const integration = store.configuredIntegrations.find(i => i.id === id)
    if (!integration) return

    const updatedCapabilities = integration.capabilities.map(cap =>
      cap.id === capabilityId ? { ...cap, active } : cap,
    )

    const result = await updateIntegration(id, {
      capabilities: updatedCapabilities,
    })
    return result
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
  }
}
