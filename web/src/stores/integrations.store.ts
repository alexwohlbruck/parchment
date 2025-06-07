import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useStorage } from '@vueuse/core'
import {
  IntegrationId,
  type IntegrationDefinition,
  type IntegrationRecord,
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
  const integrationConfigurations = useStorage<IntegrationRecord[]>(
    'integration-configurations',
    [],
  )
  const availableIntegrations = useStorage<IntegrationDefinition[]>(
    'available-integrations',
    [],
  )

  // Loading states
  const isLoadingAvailable = ref(false)
  const isLoadingConfigured = ref(false)

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

  // Get the Mapbox access token from configured integrations
  const mapboxAccessToken = computed(() => {
    const mapboxConfig = integrationConfigurations.value.find(
      config => config.integrationId === IntegrationId.MAPBOX,
    )
    return mapboxConfig?.config?.accessToken as string | undefined
  })

  // Generic function to get integration config by ID
  function getIntegrationConfig(integrationId: IntegrationId) {
    const config = integrationConfigurations.value.find(
      config => config.integrationId === integrationId,
    )
    return config?.config
  }

  // Generic function to get specific config value by integration and key
  function getIntegrationConfigValue(
    integrationId: IntegrationId,
    key: string,
  ) {
    const config = getIntegrationConfig(integrationId)
    return config?.[key]
  }

  // Check if integrations are ready (both requests completed)
  const integrationsReady = computed(() => {
    return !isLoadingAvailable.value && !isLoadingConfigured.value
  })

  // Check if Mapbox is available but not configured
  const isMapboxAvailableButNotConfigured = computed(() => {
    const isMapboxAvailable = availableIntegrations.value.some(
      integration => integration.id === IntegrationId.MAPBOX,
    )
    const isMapboxConfigured = !!mapboxAccessToken.value
    return integrationsReady.value && isMapboxAvailable && !isMapboxConfigured
  })

  function getConfigurationsForIntegration(integrationId: string) {
    return integrationConfigurations.value.filter(
      config => config.integrationId === integrationId,
    )
  }

  return {
    getIcon,
    integrationConfigurations,
    unconfiguredIntegrations,
    availableIntegrations,
    configuredIntegrations,
    getConfigurationsForIntegration,
    mapboxAccessToken,
    integrationsReady,
    isMapboxAvailableButNotConfigured,
    isLoadingAvailable,
    isLoadingConfigured,
    getIntegrationConfig,
    getIntegrationConfigValue,
  }
})
