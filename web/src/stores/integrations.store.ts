import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useStorage } from '@vueuse/core'
import {
  IntegrationId,
  IntegrationCapabilityId,
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
  siWikidata,
  siWikipedia,
  siWikimediacommons,
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
  [IntegrationId.VALHALLA]: siOpenstreetmap,
  [IntegrationId.WIKIDATA]: siWikidata,
  [IntegrationId.WIKIPEDIA]: siWikipedia,
  [IntegrationId.WIKIMEDIA]: siWikimediacommons,
}

const getIcon = (integrationId: string) => {
  return iconMap[integrationId]
}

export const useIntegrationsStore = defineStore('integrations', () => {
  // Use null as default to distinguish "never fetched" from "fetched but empty"
  // null = not initialized, [] = initialized but no integrations
  const integrationConfigurations = useStorage<IntegrationRecord[] | null>(
    'integration-configurations',
    null,
  )
  const availableIntegrations = useStorage<IntegrationDefinition[] | null>(
    'available-integrations',
    null,
  )
  
  // Helper to safely get array value (handles corrupted cache data)
  const safeConfigurationsArray = () => 
    Array.isArray(integrationConfigurations.value) ? integrationConfigurations.value : []
  const safeAvailableArray = () => 
    Array.isArray(availableIntegrations.value) ? availableIntegrations.value : []

  // Loading states
  const isLoadingAvailable = ref(false)
  const isLoadingConfigured = ref(false)
  
  // Track whether integrations have been fetched at least once
  // null means not initialized, array (even empty) means initialized
  const hasInitialized = ref(
    Array.isArray(integrationConfigurations.value) || Array.isArray(availableIntegrations.value)
  )

  const configuredIntegrations = computed(() => {
    return safeAvailableArray().map(integration => ({
      ...integration,
      configuration: safeConfigurationsArray().filter(
        config => config.integrationId === integration.id,
      ),
    }))
  })

  const unconfiguredIntegrations = computed(() => {
    return safeAvailableArray().filter(
      integration =>
        !safeConfigurationsArray().some(
          config => config.integrationId === integration.id,
        ),
    )
  })

  // Get the Mapbox access token from configured integrations
  const mapboxAccessToken = computed(() => {
    const mapboxConfig = safeConfigurationsArray().find(
      config => config.integrationId === IntegrationId.MAPBOX,
    )
    return mapboxConfig?.config?.accessToken as string | undefined
  })

  // Generic function to get integration config by ID
  function getIntegrationConfig(integrationId: IntegrationId) {
    const config = safeConfigurationsArray().find(
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
  
  // Check if a specific capability is active for an integration
  function isCapabilityActive(
    integrationId: IntegrationId,
    capabilityId: IntegrationCapabilityId,
  ): boolean {
    const integrationConfig = safeConfigurationsArray().find(
      config => config.integrationId === integrationId,
    )
    if (!integrationConfig) return false
    
    const capability = integrationConfig.capabilities?.find(
      cap => cap.id === capabilityId,
    )
    return capability?.active ?? false
  }
  
  // Check if Mapbox engine capability is configured and active
  const isMapboxEngineActive = computed(() => {
    const hasToken = !!mapboxAccessToken.value
    const isEngineCapabilityActive = isCapabilityActive(
      IntegrationId.MAPBOX,
      IntegrationCapabilityId.MAP_ENGINE,
    )
    return hasToken && isEngineCapabilityActive
  })

  // Check if integrations are ready (initialized and not currently loading)
  const integrationsReady = computed(() => {
    return hasInitialized.value && !isLoadingAvailable.value && !isLoadingConfigured.value
  })

  // Check if Mapbox is available but not configured (or configured but engine disabled)
  const isMapboxAvailableButNotConfigured = computed(() => {
    const isMapboxAvailable = safeAvailableArray().some(
      integration => integration.id === IntegrationId.MAPBOX,
    )
    // Mapbox is "not configured" if either no token or engine capability is disabled
    const isMapboxUsable = isMapboxEngineActive.value
    return integrationsReady.value && isMapboxAvailable && !isMapboxUsable
  })

  function getConfigurationsForIntegration(integrationId: string) {
    return safeConfigurationsArray().filter(
      config => config.integrationId === integrationId,
    )
  }

  // Clear all cached data (used on sign out)
  function clearCache() {
    integrationConfigurations.value = null
    availableIntegrations.value = null
    hasInitialized.value = false
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
    hasInitialized,
    isMapboxAvailableButNotConfigured,
    isMapboxEngineActive,
    isLoadingAvailable,
    isLoadingConfigured,
    getIntegrationConfig,
    getIntegrationConfigValue,
    isCapabilityActive,
    clearCache,
  }
})
