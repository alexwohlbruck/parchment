<script setup lang="ts">
import { ref, computed, inject, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { useIntegrationService } from '@/services/integration.service'
import {
  IntegrationId,
  type IntegrationDefinition,
} from '@server/types/integration.types'
import IntegrationTile from '@/components/integration/IntegrationTile.vue'
import { validateKey } from './types'

const FREE_IDS: string[] = [
  IntegrationId.NOMINATIM,
  IntegrationId.OVERPASS,
  IntegrationId.WIKIDATA,
  IntegrationId.WIKIPEDIA,
  IntegrationId.WIKIMEDIA,
]

const DEFAULT_CONFIGS: Record<string, Record<string, any>> = {
  [IntegrationId.NOMINATIM]: {
    host: 'https://nominatim.openstreetmap.org',
  },
  [IntegrationId.OVERPASS]: {
    host: 'https://overpass-api.de/api/interpreter',
  },
  [IntegrationId.WIKIDATA]: {},
  [IntegrationId.WIKIPEDIA]: {},
  [IntegrationId.WIKIMEDIA]: {},
}

const { t } = useI18n()
const store = useIntegrationsStore()
const integrationService = useIntegrationService()

const validation = inject(validateKey)

onMounted(async () => {
  await integrationService.fetchAvailableIntegrations()
  await integrationService.fetchConfiguredIntegrations()
  validation?.register(() => true)
  await autoConfigureFree()
})

const sortedIntegrations = computed(() => {
  const all = store.allIntegrations
  if (!all) return []
  return [...all].sort((a, b) => {
    const aFree = FREE_IDS.includes(a.integration.id)
    const bFree = FREE_IDS.includes(b.integration.id)
    if (aFree && !bFree) return -1
    if (!aFree && bFree) return 1
    return a.integration.name.localeCompare(b.integration.name)
  })
})

function isFree(id: string) {
  return FREE_IDS.includes(id)
}

async function autoConfigureFree() {
  const available = store.availableIntegrations
  if (!Array.isArray(available)) return
  const unconfigured = available.filter(
    i =>
      FREE_IDS.includes(i.id) &&
      !store.integrationConfigurations?.some(c => c.integrationId === i.id),
  )
  for (const integration of unconfigured) {
    try {
      const config = DEFAULT_CONFIGS[integration.id] ?? {}
      const capabilities = integration.capabilities.map(id => ({
        id,
        active: true,
      }))
      await integrationService.createIntegration(
        integration.id,
        config,
        capabilities,
      )
    } catch {
      // Non-critical — user can configure manually
    }
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="text-center space-y-1">
      <h2 class="text-xl font-semibold">
        {{ t('onboarding.integrations.title') }}
      </h2>
      <p class="text-sm text-muted-foreground">
        {{ t('onboarding.integrations.description') }}
      </p>
    </div>

    <!-- All integrations grid -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      <div
        v-for="item in sortedIntegrations"
        :key="item.config?.id || item.integration.id"
        :class="[
          'rounded-xl transition-shadow',
          isFree(item.integration.id)
            ? 'ring-1 ring-primary/30'
            : '',
        ]"
      >
        <IntegrationTile
          :integration="item.integration"
          :configuration="item.config"
        />
      </div>
    </div>
  </div>
</template>
