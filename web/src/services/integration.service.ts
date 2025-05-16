import { ref, computed } from 'vue'
import type {
  IntegrationCapability,
  IntegrationDefinition,
  IntegrationResponse,
} from '@server/types/integration.types'
import {
  IntegrationCapabilityId,
  IntegrationId,
} from '@server/types/integration.types'
import { api } from '@/lib/api'
import { useAuthService } from './auth.service'
import {
  siGooglemaps,
  siOpenstreetmap,
  siYelp,
  siFoursquare,
  siMapillary,
  siTripadvisor,
} from 'simple-icons'
import { UiIntegration } from '@/types/integrations.types'

const iconMap: Record<string, any> = {
  [IntegrationId.GOOGLE_MAPS]: siGooglemaps,
  [IntegrationId.PELIAS]: siOpenstreetmap,
  [IntegrationId.GRAPHHOPPER]: siOpenstreetmap,
  [IntegrationId.YELP]: siYelp,
  [IntegrationId.FOURSQUARE]: siFoursquare,
  [IntegrationId.MAPILLARY]: siMapillary,
  [IntegrationId.NOMINATIM]: siOpenstreetmap,
  [IntegrationId.TRIPADVISOR]: siTripadvisor,
  [IntegrationId.OPENTABLE]: null,
  [IntegrationId.GEOAPIFY]: null,
}

export function useIntegrationService() {
  const authService = useAuthService()
  const configuredIntegrations = ref<IntegrationResponse[]>([])
  const availableIntegrations = ref<IntegrationDefinition[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  const formattedAvailableIntegrations = computed<UiIntegration[]>(() => {
    const configuredIntegrationIds = new Set(
      configuredIntegrations.value.map(
        integration => integration.integrationId,
      ),
    )

    return availableIntegrations.value
      .filter(integration => !configuredIntegrationIds.has(integration.id))
      .map(integration => ({
        id: integration.id,
        name: integration.name,
        description: integration.description,
        icon: iconMap[integration.id] || null,
        color: integration.color,
        capabilities: integration.capabilities,
        status: 'available',
        paid: integration.paid,
        cloud: integration.cloud,
        configSchema: integration.configSchema,
      }))
  })

  const formattedConfiguredIntegrations = computed<UiIntegration[]>(() => {
    return configuredIntegrations.value.map(integration => {
      const definition = availableIntegrations.value.find(
        def => def.id === integration.integrationId,
      )

      return {
        id: integration.id,
        integrationId: integration.integrationId,
        name: definition?.name || 'Unknown Integration',
        description: definition?.description || '',
        icon: iconMap[integration.integrationId] || null,
        color: definition?.color || '#888888',
        capabilities: integration.capabilities.map(cap => cap.id),
        capabilityRecords: integration.capabilities,
        status: 'active',
        paid: definition?.paid || false,
        cloud: definition?.cloud || false,
        configSchema: definition?.configSchema,
        config: integration.config,
        enabled: integration.capabilities.every(cap => cap.active),
      }
    })
  })

  async function fetchIntegrations() {
    try {
      await authService.getAuthenticatedUser()
    } catch (err) {
      console.error('User not authenticated')
      return
    }

    isLoading.value = true
    error.value = null

    try {
      const availableResponse = await api.get('/integrations/available')
      availableIntegrations.value = availableResponse.data

      const configuredResponse = await api.get('/integrations/configured')
      configuredIntegrations.value = configuredResponse.data
    } catch (err: any) {
      error.value = err.message || 'Failed to fetch integrations'
      console.error('Error fetching integrations:', err)
    } finally {
      isLoading.value = false
    }
  }

  async function fetchAvailableIntegrations() {
    isLoading.value = true
    error.value = null

    try {
      const response = await api.get('/integrations/available')
      availableIntegrations.value = response.data
      return response.data
    } catch (err: any) {
      error.value = err.message || 'Failed to fetch available integrations'
      console.error('Error fetching available integrations:', err)
      throw error.value
    } finally {
      isLoading.value = false
    }
  }

  async function fetchConfiguredIntegrations() {
    try {
      await authService.getAuthenticatedUser()
    } catch (err) {
      console.error('User not authenticated')
      return []
    }

    isLoading.value = true
    error.value = null

    try {
      const response = await api.get('/integrations/configured')
      configuredIntegrations.value = response.data
      return response.data
    } catch (err: any) {
      error.value = err.message || 'Failed to fetch configured integrations'
      console.error('Error fetching configured integrations:', err)
      return []
    } finally {
      isLoading.value = false
    }
  }

  async function createIntegration(
    integrationId: string,
    config: Record<string, any>,
    capabilities?: IntegrationCapability[],
  ) {
    isLoading.value = true
    error.value = null

    try {
      const requestData: any = {
        integrationId,
        config,
      }

      if (capabilities) {
        requestData.capabilities = capabilities
      }

      const response = await api.post('/integrations', requestData)

      await fetchConfiguredIntegrations()
      return response.data
    } catch (err: any) {
      error.value =
        err.response?.data?.message ||
        err.message ||
        'Failed to create integration'
      console.error('Error creating integration:', err)
      throw error.value
    } finally {
      isLoading.value = false
    }
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

    try {
      const response = await api.put(`/integrations/${id}`, updates)

      await fetchConfiguredIntegrations()
      return response.data
    } catch (err: any) {
      error.value =
        err.response?.data?.message ||
        err.message ||
        'Failed to update integration'
      console.error('Error updating integration:', err)
      throw error.value
    } finally {
      isLoading.value = false
    }
  }

  async function deleteIntegration(id: string) {
    isLoading.value = true
    error.value = null

    try {
      await api.delete(`/integrations/${id}`)

      await fetchConfiguredIntegrations()
      return true
    } catch (err: any) {
      error.value =
        err.response?.data?.message ||
        err.message ||
        'Failed to delete integration'
      console.error('Error deleting integration:', err)
      throw error.value
    } finally {
      isLoading.value = false
    }
  }

  async function testIntegrationConfig(
    integrationId: string,
    config: Record<string, any>,
  ) {
    isLoading.value = true
    error.value = null

    try {
      const response = await api.post('/integrations/test', {
        integrationId,
        config,
      })

      return response.data
    } catch (err: any) {
      error.value =
        err.response?.data?.message ||
        err.message ||
        'Failed to test integration'
      console.error('Error testing integration:', err)
      throw error.value
    } finally {
      isLoading.value = false
    }
  }

  async function toggleIntegrationEnabled(id: string, enabled: boolean) {
    const integration = configuredIntegrations.value.find(i => i.id === id)
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
    const integration = configuredIntegrations.value.find(i => i.id === id)
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
    configuredIntegrations: formattedConfiguredIntegrations,
    availableIntegrations: formattedAvailableIntegrations,
    isLoading,
    error,
    fetchIntegrations,
    fetchAvailableIntegrations,
    fetchConfiguredIntegrations,
    createIntegration,
    updateIntegration,
    deleteIntegration,
    testIntegrationConfig,
    toggleIntegrationEnabled,
    toggleCapability,
  }
}
