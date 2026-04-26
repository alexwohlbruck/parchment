import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useStorage } from '@vueuse/core'
import {
  IntegrationId,
  IntegrationCapabilityId,
  type IntegrationDefinition,
  type IntegrationRecord,
  type IntegrationScheme,
} from '@server/types/integration.types'
import { jsonSerializer } from '@/lib/storage'
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
  [IntegrationId.OPENWEATHERMAP]: null, // Uses custom weather icon
  [IntegrationId.OPENSTREETMAP]: siOpenstreetmap,
  [IntegrationId.OPENSTREETMAP_ACCOUNT]: siOpenstreetmap,
}

const getIcon = (integrationId: string) => {
  return iconMap[integrationId]
}

export const useIntegrationsStore = defineStore('integrations', () => {
  // Use null as default to distinguish "never fetched" from "fetched but empty"
  // null = not initialized, [] = initialized but no integrations
  // Must specify serializer explicitly because null default causes vueuse to
  // pick the "any" serializer which corrupts objects via String()
  const integrationConfigurations = useStorage<IntegrationRecord[] | null>(
    'integration-configurations',
    null,
    undefined,
    { serializer: jsonSerializer },
  )
  const availableIntegrations = useStorage<IntegrationDefinition[] | null>(
    'available-integrations',
    null,
    undefined,
    { serializer: jsonSerializer },
  )
  
  // Helper to safely get array value (handles corrupted cache data)
  const safeConfigurationsArray = () => 
    Array.isArray(integrationConfigurations.value) ? integrationConfigurations.value : []
  const safeAvailableArray = () => 
    Array.isArray(availableIntegrations.value) ? availableIntegrations.value : []

  // Loading states
  const isLoadingAvailable = ref(false)
  const isLoadingConfigured = ref(false)
  
  // Both data sources must be available (from cache or API) before integrations are considered ready
  const integrationsReady = computed(
    () => Array.isArray(integrationConfigurations.value) && Array.isArray(availableIntegrations.value)
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

  // Unified list: each entry is { integration, config? }
  // Configured integrations may appear multiple times (one per config record)
  const allIntegrations = computed<
    { integration: IntegrationDefinition; config?: IntegrationRecord }[]
  >(() => {
    const configs = safeConfigurationsArray()
    return safeAvailableArray().flatMap(integration => {
      const matchingConfigs = configs.filter(
        c => c.integrationId === integration.id,
      )
      if (matchingConfigs.length > 0) {
        return matchingConfigs.map(config => ({ integration, config }))
      }
      return [{ integration }]
    })
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

  // OSM profile data (derived from integration config)
  const osmProfile = computed(() => {
    const config = getIntegrationConfig(IntegrationId.OPENSTREETMAP_ACCOUNT) as any
    if (!config) return null
    return {
      osmDisplayName: config.osmDisplayName as string | undefined,
      osmProfileImageUrl: config.osmProfileImageUrl as string | undefined,
      osmAccountCreated: config.osmAccountCreated as string | undefined,
      osmChangesetCount: config.osmChangesetCount as number | undefined,
      osmTraceCount: config.osmTraceCount as number | undefined,
    }
  })

  // Check if weather capability is configured and active
  const isWeatherActive = computed(() => {
    return isCapabilityActive(
      IntegrationId.OPENWEATHERMAP,
      IntegrationCapabilityId.WEATHER,
    )
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

  /**
   * Single-record selector used by dual-scheme tiles: returns the one
   * configuration for this (integrationId, scheme) pair, or undefined.
   * Guaranteed unique by the server-side partial unique index.
   */
  function getConfigurationForScheme(
    integrationId: string,
    scheme: IntegrationScheme,
  ) {
    return safeConfigurationsArray().find(
      config =>
        config.integrationId === integrationId && config.scheme === scheme,
    )
  }

  // Clear all cached data (used on sign out)
  function clearCache() {
    integrationConfigurations.value = null
    availableIntegrations.value = null
  }

  return {
    getIcon,
    integrationConfigurations,
    unconfiguredIntegrations,
    availableIntegrations,
    allIntegrations,
    configuredIntegrations,
    getConfigurationsForIntegration,
    getConfigurationForScheme,
    mapboxAccessToken,
    integrationsReady,
    isMapboxAvailableButNotConfigured,
    isMapboxEngineActive,
    isWeatherActive,
    isLoadingAvailable,
    isLoadingConfigured,
    getIntegrationConfig,
    getIntegrationConfigValue,
    isCapabilityActive,
    osmProfile,
    clearCache,
  }
})
