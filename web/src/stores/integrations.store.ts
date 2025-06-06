import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useStorage } from '@vueuse/core'
import {
  IntegrationId,
  type IntegrationDefinition,
  type IntegrationResponse,
} from '@server/types/integration.types'
import { api } from '@/lib/api'
import {
  siFoursquare,
  siGooglemaps,
  siMapillary,
  siOpenstreetmap,
  siMapbox,
  siTripadvisor,
  siYelp,
} from 'simple-icons'
import { Integration } from '@/types/integrations.types'

const iconMap: Record<string, any> = {
  [IntegrationId.GOOGLE_MAPS]: siGooglemaps,
  [IntegrationId.PELIAS]: siOpenstreetmap,
  [IntegrationId.GRAPHHOPPER]: siOpenstreetmap,
  [IntegrationId.OVERPASS]: siOpenstreetmap,
  [IntegrationId.YELP]: siYelp,
  [IntegrationId.FOURSQUARE]: siFoursquare,
  [IntegrationId.MAPILLARY]: siMapillary,
  [IntegrationId.NOMINATIM]: siOpenstreetmap,
  [IntegrationId.TRIPADVISOR]: siTripadvisor,
  [IntegrationId.OPENTABLE]: null,
  [IntegrationId.GEOAPIFY]: null,
  [IntegrationId.MAPBOX]: siMapbox,
}

const getIcon = (integrationId: string) => {
  return iconMap[integrationId]
}

export const useIntegrationsStore = defineStore('integrations', () => {
  const integrationConfigurations = useStorage<IntegrationResponse[]>(
    'configured-integrations',
    [],
  )
  const availableIntegrations = useStorage<IntegrationDefinition[]>(
    'available-integrations',
    [],
  )

  const configuredIntegrations = computed(() => {
    return availableIntegrations.value.map(integration => ({
      ...integration,
      configuration: integrationConfigurations.value.filter(
        config => config.integrationId === integration.id,
      ),
    }))
  })

  const unconfiguredIntegrations = computed(() => {
    return availableIntegrations.value.filter(
      integration =>
        !integrationConfigurations.value.some(
          config => config.integrationId === integration.id,
        ),
    )
  })

  function getConfigurationsForIntegration(integrationId: string) {
    return integrationConfigurations.value.filter(
      config => config.integrationId === integrationId,
    )
  }

  const isLoading = ref(false)

  async function fetchAvailableIntegrations() {
    isLoading.value = true
    try {
      const response = await api.get<IntegrationDefinition[]>(
        '/integrations/available',
      )
      availableIntegrations.value = response.data
      return response.data
    } finally {
      isLoading.value = false
    }
  }

  async function fetchConfiguredIntegrations() {
    isLoading.value = true
    try {
      const response = await api.get<IntegrationResponse[]>(
        '/integrations/configured',
      )
      integrationConfigurations.value = response.data
      return response.data
    } finally {
      isLoading.value = false
    }
  }

  return {
    isLoading,
    getIcon,
    integrationConfigurations,
    unconfiguredIntegrations,
    availableIntegrations,
    configuredIntegrations,
    // integrations,
    getConfigurationsForIntegration,
    fetchAvailableIntegrations,
    fetchConfiguredIntegrations,
  }
})
