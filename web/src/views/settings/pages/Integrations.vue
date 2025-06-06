<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { onMounted } from 'vue'
import IntegrationsList from '@/components/integration/IntegrationsList.vue'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { LoaderCircleIcon } from 'lucide-vue-next'

const { t } = useI18n()
const integrationStore = useIntegrationsStore()

// Fetch integrations when component is mounted
onMounted(async () => {
  try {
    // First fetch available integrations (metadata)
    await integrationStore.fetchAvailableIntegrations()

    // Then fetch configured integrations
    await integrationStore.fetchConfiguredIntegrations()
  } catch (error) {
    console.error('Failed to load integrations:', error)
  }
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <div
      v-if="integrationStore.isLoading"
      class="flex justify-center items-center py-10"
    >
      <LoaderCircleIcon class="animate-spin h-8 w-8 text-primary" />
    </div>

    <div v-else>
      <!-- Configured Integrations -->
      <IntegrationsList
        :title="t('settings.integrations.title')"
        :description="t('settings.integrations.description')"
        :integrations="integrationStore.configuredIntegrations"
        :empty-message="t('settings.integrations.noConfigured')"
        :configured="true"
      />

      <!-- Available Integrations -->
      <IntegrationsList
        :title="t('settings.integrations.available')"
        :integrations="integrationStore.unconfiguredIntegrations"
        :empty-message="t('settings.integrations.noAvailable')"
        :configured="false"
      />
    </div>
  </div>
</template>
