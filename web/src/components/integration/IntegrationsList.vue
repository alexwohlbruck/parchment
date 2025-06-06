<script setup lang="ts">
import {
  IntegrationDefinition,
  IntegrationResponse,
} from '@/types/integrations.types'
import { SettingsSection } from '@/components/settings'
import IntegrationTile from '@/components/integration/IntegrationTile.vue'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { useAuthService } from '@/services/auth.service'
import { PermissionId } from '@/types/auth.types'
import { computed } from 'vue'

const integrationsStore = useIntegrationsStore()
const authService = useAuthService()

const props = defineProps<{
  title: string
  description?: string
  integrations: IntegrationDefinition[]
  emptyMessage: string
  configured?: boolean
}>()

// Define emits
const emit = defineEmits<{
  (
    e: 'integrationClick',
    integration: IntegrationDefinition,
    config?: IntegrationResponse,
  ): void
  (
    e: 'integrationDelete',
    integration: IntegrationDefinition,
    config?: IntegrationResponse,
  ): void
}>()

function handleIntegrationClick(
  integration: IntegrationDefinition,
  config?: IntegrationResponse,
) {
  emit('integrationClick', integration, config)
}

function handleIntegrationDelete(
  integration: IntegrationDefinition,
  config?: IntegrationResponse,
) {
  emit('integrationDelete', integration, config)
}

const integrations = computed<
  {
    integration: IntegrationDefinition
    config?: IntegrationResponse
  }[]
>(() => {
  return props.integrations
    .map(integration =>
      props.configured
        ? integrationsStore
            .getConfigurationsForIntegration(integration.id)
            .map(config => ({
              integration,
              config,
            }))
        : { integration },
    )
    .flat()
})
</script>

<template>
  <SettingsSection
    :title="title"
    :description="description"
    :frame="false"
    :shadow="false"
  >
    <div
      v-if="integrations.length === 0"
      class="text-center py-8 text-muted-foreground"
    >
      {{ emptyMessage }}
    </div>

    <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <IntegrationTile
        v-for="integration in integrations"
        :key="integration.config?.id || integration.integration.id"
        :integration="integration.integration"
        :configuration="integration.config"
        :disabled="
          !authService.hasPermission(PermissionId.INTEGRATIONS_WRITE_SYSTEM)
        "
        @click="handleIntegrationClick"
        @delete="handleIntegrationDelete"
      />
    </div>
  </SettingsSection>
</template>
