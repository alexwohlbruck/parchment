<script setup lang="ts">
import { UiIntegration } from '@/types/integrations.types'
import { SettingsSection } from '@/components/settings'
import IntegrationTile from '@/components/integration/IntegrationTile.vue'

// Define props
const props = defineProps<{
  title: string
  description?: string
  integrations: UiIntegration[]
  emptyMessage: string
}>()

// Define emits
const emit = defineEmits<{
  (e: 'integrationClick', integration: UiIntegration): void
  (e: 'integrationDelete', integration: UiIntegration): void
}>()

function handleIntegrationClick(integration: UiIntegration) {
  emit('integrationClick', integration)
}

function handleIntegrationDelete(integration: UiIntegration) {
  emit('integrationDelete', integration)
}
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
        :key="integration.id"
        :integration="integration"
        @click="handleIntegrationClick"
        @delete="handleIntegrationDelete"
      />
    </div>
  </SettingsSection>
</template>
