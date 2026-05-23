<script setup lang="ts">
import { ref, computed, inject, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { useIntegrationService } from '@/services/integration.service'
import {
  IntegrationId,
  type IntegrationDefinition,
} from '@server/types/integration.types'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Check, Zap } from 'lucide-vue-next'
import { validateKey } from './types'

const FREE_CLOUD_IDS: string[] = [
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

const configuring = ref(false)
const configured = ref(false)
const error = ref<string | null>(null)

const validation = inject(validateKey)

onMounted(async () => {
  await integrationService.fetchAvailableIntegrations()
  await integrationService.fetchConfiguredIntegrations()
  validation?.register(() => true)
})

const freeIntegrations = computed<IntegrationDefinition[]>(() => {
  const available = store.availableIntegrations
  if (!Array.isArray(available)) return []
  return available.filter(i => FREE_CLOUD_IDS.includes(i.id))
})

const unconfiguredFree = computed(() => {
  return freeIntegrations.value.filter(
    i =>
      !store.integrationConfigurations?.some(
        c => c.integrationId === i.id,
      ),
  )
})

const allConfigured = computed(
  () => freeIntegrations.value.length > 0 && unconfiguredFree.value.length === 0,
)

async function autoConfigureAll() {
  configuring.value = true
  error.value = null
  try {
    for (const integration of unconfiguredFree.value) {
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
    }
    configured.value = true
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to configure integrations'
  } finally {
    configuring.value = false
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

    <div class="space-y-4">
      <div class="grid grid-cols-1 gap-2">
        <div
          v-for="integration in freeIntegrations"
          :key="integration.id"
          class="flex items-center gap-3 rounded-lg border p-3"
          :class="[
            allConfigured || !unconfiguredFree.some(u => u.id === integration.id)
              ? 'bg-muted/30'
              : '',
          ]"
        >
          <div
            class="integration-icon size-9 flex items-center justify-center rounded-md shadow-xs border shrink-0"
            :style="`--integration-color: ${integration.color}`"
          >
            <svg
              v-if="store.getIcon(integration.id)"
              class="integration-icon-fg size-5"
              viewBox="0 0 24 24"
              fill="currentColor"
              v-html="store.getIcon(integration.id).svg"
            />
            <span v-else class="integration-icon-fg font-medium text-sm">
              {{ integration.name[0] }}
            </span>
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium">{{ integration.name }}</p>
            <p class="text-xs text-muted-foreground truncate">
              {{ integration.description }}
            </p>
          </div>
          <Check
            v-if="!unconfiguredFree.some(u => u.id === integration.id)"
            class="size-4 text-primary shrink-0"
          />
        </div>
      </div>

      <div v-if="error" class="text-sm text-destructive text-center">
        {{ error }}
      </div>

      <Button
        v-if="!allConfigured"
        class="w-full"
        :disabled="configuring"
        @click="autoConfigureAll"
      >
        <Spinner v-if="configuring" class="size-4 mr-2" />
        <Zap v-else class="size-4 mr-2" />
        {{ t('onboarding.integrations.enableAll') }}
      </Button>

      <p v-else class="text-sm text-center text-muted-foreground">
        {{ t('onboarding.integrations.allConfigured') }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.integration-icon {
  background-color: oklch(
    from var(--integration-color) calc(l + 0.5) calc(c - 0.08) h
  );
  border-color: oklch(
    from var(--integration-color) calc(l - 0.2) calc(c + 0.05) h / 0.1
  );
}
.integration-icon-fg {
  color: oklch(from var(--integration-color) calc(l - 0.2) calc(c + 0.05) h);
}
:is(.dark *) .integration-icon {
  background-color: oklch(
    from var(--integration-color) calc(l - 0.35) calc(c - 0.05) h
  );
  border-color: oklch(
    from var(--integration-color) calc(l + 0.25) calc(c - 0.05) h / 0.1
  );
}
:is(.dark *) .integration-icon-fg {
  color: oklch(from var(--integration-color) calc(l + 0.25) calc(c - 0.05) h);
}
</style>
