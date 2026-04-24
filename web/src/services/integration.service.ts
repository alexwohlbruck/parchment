import { ref } from 'vue'
import type {
  IntegrationCapability,
  IntegrationRecord,
  IntegrationDefinition,
  IntegrationScheme,
} from '@server/types/integration.types'
import {
  IntegrationCapabilityId,
  IntegrationId,
} from '@server/types/integration.types'
import { api } from '@/lib/api'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { useLayersStore } from '@/stores/layers.store'
import { useNotesStore } from '@/stores/notes.store'
import { useAuthStore } from '@/stores/auth.store'
import { saveBlob, decryptBlobEnvelope } from '@/lib/personal-blob'

// Personal-blob type namespace for user-e2ee integration configs. Kept in
// sync with INTEGRATION_CONFIG_BLOB_PREFIX on the server.
export const INTEGRATION_CONFIG_BLOB_PREFIX = 'integration-config:'
export const integrationConfigBlobType = (integrationId: string) =>
  `${INTEGRATION_CONFIG_BLOB_PREFIX}${integrationId}`

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
  const authStore = useAuthStore()
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  async function refreshLayersIfNeeded(integrationId?: string) {
    try {
      // Reload layers if the integration involved can affect map layers
      const configs = Array.isArray(store.integrationConfigurations) ? store.integrationConfigurations : []
      const justUpdated = configs.find(
        i => i.integrationId === integrationId,
      )
      if (!integrationId || hasMapLayerCapability(justUpdated)) {
        await layersStore.loadLayers()
      }
    } catch (e) {}
  }

  function clearNotesCacheIfNeeded(integrationId?: string) {
    if (integrationId === IntegrationId.OPENSTREETMAP) {
      const notesStore = useNotesStore()
      notesStore.clearCache()
    }
  }

  async function createIntegration(
    integrationId: string,
    config: Record<string, any>,
    capabilities?: IntegrationCapability[],
    scheme: IntegrationScheme = 'server-key',
  ) {
    isLoading.value = true
    error.value = null

    if (scheme === 'user-e2ee') {
      const userId = authStore.me?.id
      if (!userId) {
        throw new Error(
          'Cannot create user-e2ee integration without an authenticated user',
        )
      }

      // 1. Create metadata-only row server-side (no config in the body).
      const response = await api.post('/integrations', {
        integrationId,
        config: {},
        capabilities,
        scheme: 'user-e2ee',
      })
      const created = response.data as IntegrationRecord

      // 2. Encrypt + upload the config as a personal blob. If this fails we
      //    roll back the metadata row so the user isn't left with a "Connected"
      //    tile pointing at a row that has no readable config.
      try {
        await saveBlob(
          integrationConfigBlobType(integrationId),
          userId,
          config,
        )
      } catch (err) {
        await api.delete(`/integrations/${created.id}`).catch(() => {
          // Best-effort rollback; if it fails too, the user can retry disconnect.
        })
        throw err
      }

      // 3. Refresh the caches so the tile renders as "Connected".
      await fetchConfiguredIntegrations()
      await fetchAvailableIntegrations()
      await refreshLayersIfNeeded(integrationId)
      return created
    }

    const requestData: any = {
      integrationId,
      config,
    }

    if (capabilities) {
      requestData.capabilities = capabilities
    }

    const response = await api.post('/integrations', requestData)

    await fetchConfiguredIntegrations()
    await fetchAvailableIntegrations()
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

    // Look up the existing record's scheme. For user-e2ee rows, config updates
    // go straight to the personal-blob endpoint (the server never sees the
    // new config) and only capability updates ride the integrations PUT.
    const configsBefore = Array.isArray(store.integrationConfigurations)
      ? store.integrationConfigurations
      : []
    const existing = configsBefore.find((i) => i.id === id)

    if (existing?.scheme === 'user-e2ee' && updates.config) {
      const userId = authStore.me?.id
      if (!userId) {
        throw new Error('Cannot update user-e2ee config without a user')
      }
      await saveBlob(
        integrationConfigBlobType(existing.integrationId),
        userId,
        updates.config,
      )
      // Capabilities (if also provided) still go through the server.
      if (updates.capabilities) {
        await api.put(`/integrations/${id}`, {
          capabilities: updates.capabilities,
        })
      }
      await fetchConfiguredIntegrations()
      await refreshLayersIfNeeded(existing.integrationId)
      clearNotesCacheIfNeeded(existing.integrationId)
      return existing
    }

    const response = await api.put(`/integrations/${id}`, updates)

    await fetchConfiguredIntegrations()
    const configsAfterUpdate = Array.isArray(store.integrationConfigurations) ? store.integrationConfigurations : []
    const updated = configsAfterUpdate.find(i => i.id === id)
    await refreshLayersIfNeeded(updated?.integrationId)
    clearNotesCacheIfNeeded(updated?.integrationId)
    return response.data
  }

  async function deleteIntegration(id: IntegrationRecord['id']) {
    isLoading.value = true
    error.value = null

    const configsBeforeDelete = Array.isArray(store.integrationConfigurations) ? store.integrationConfigurations : []
    const deleted = configsBeforeDelete.find(i => i.id === id)

    await api.delete(`/integrations/${id}`)

    await fetchConfiguredIntegrations()
    await fetchAvailableIntegrations()
    await refreshLayersIfNeeded(deleted?.integrationId)
    clearNotesCacheIfNeeded(deleted?.integrationId)
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
    const configs = Array.isArray(store.integrationConfigurations) ? store.integrationConfigurations : []
    const integration = configs.find(i => i.id === id)
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
    const configs = Array.isArray(store.integrationConfigurations) ? store.integrationConfigurations : []
    const integration = configs.find(i => i.id === id)
    if (!integration) return

    const updatedCapabilities = integration.capabilities.map(cap =>
      cap.id === capabilityId ? { ...cap, active } : cap,
    )

    const result = await updateIntegration(id, {
      capabilities: updatedCapabilities,
    })
    return result
  }

  /**
   * Fetch available integrations from server.
   * If cached data exists (is array), returns immediately and refreshes in background.
   */
  async function fetchAvailableIntegrations() {
    // Array (even empty) = cached, null/other = never fetched
    const hasCachedData = Array.isArray(store.availableIntegrations)
    
    if (hasCachedData) {
      // Return cached data immediately, refresh in background
      api.get<IntegrationDefinition[]>('/integrations/available')
        .then(response => {
          store.availableIntegrations = response.data
        })
        .catch(error => {
          console.error('Failed to refresh available integrations:', error)
        })
      return store.availableIntegrations
    }
    
    // No cache - wait for response
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

  /**
   * Decrypt inline encryptedConfig blobs for user-e2ee rows and merge plaintext
   * into each record's `config` field. Server-key rows are passed through
   * unchanged. Runs one envelope decrypt per e2ee row; no network.
   */
  async function hydrateE2eeConfigs(
    records: IntegrationRecord[],
  ): Promise<IntegrationRecord[]> {
    const userId = authStore.me?.id
    if (!userId) return records

    return Promise.all(
      records.map(async (record) => {
        if (record.scheme !== 'user-e2ee' || !record.encryptedConfig) {
          return record
        }
        const blobType = integrationConfigBlobType(record.integrationId)
        const decrypted = await decryptBlobEnvelope<Record<string, any>>(
          blobType,
          userId,
          record.encryptedConfig,
        )
        // Decrypt failure leaves config={} and the tile surfaces "not configured"
        // so the user can disconnect + reconnect.
        return {
          ...record,
          config: decrypted ?? {},
          // Don't persist the ciphertext alongside plaintext in Pinia.
          encryptedConfig: undefined,
        }
      }),
    )
  }

  /**
   * Fetch configured integrations from server.
   * If cached data exists (is array), returns immediately and refreshes in background.
   */
  async function fetchConfiguredIntegrations() {
    // Array (even empty) = cached, null/other = never fetched
    const hasCachedData = Array.isArray(store.integrationConfigurations)

    if (hasCachedData) {
      // Return cached data immediately, refresh in background
      api.get<IntegrationRecord[]>('/integrations/configured')
        .then(async (response) => {
          store.integrationConfigurations = await hydrateE2eeConfigs(
            response.data,
          )
        })
        .catch(error => {
          console.error('Failed to refresh configured integrations:', error)
        })
      return store.integrationConfigurations
    }

    // No cache - wait for response
    store.isLoadingConfigured = true
    try {
      const response = await api.get<IntegrationRecord[]>(
        '/integrations/configured',
      )
      const hydrated = await hydrateE2eeConfigs(response.data)
      store.integrationConfigurations = hydrated
      return hydrated
    } finally {
      store.isLoadingConfigured = false
    }
  }

  async function fetchOsmProfile() {
    try {
      const response = await api.get('/integrations/osm/profile')
      // Refresh configured integrations to pick up updated config
      await fetchConfiguredIntegrations()
      return response.data
    } catch (error) {
      console.error('Failed to fetch OSM profile:', error)
      return null
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
    fetchOsmProfile,
  }
}
