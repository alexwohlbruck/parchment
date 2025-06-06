<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useAppService } from '@/services/app.service'
import { ref, onMounted } from 'vue'
import { useIntegrationService } from '@/services/integration.service'
import {
  IntegrationDefinition,
  IntegrationId,
  IntegrationResponse,
} from '@/types/integrations.types'
import { ZodObject } from 'zod'
import { configSchemas } from '@/types/integrations.types'
import IntegrationsList from '@/components/integration/IntegrationsList.vue'
import IntegrationForm from '@/components/integration/IntegrationForm.vue'
import { useIntegrationsStore } from '@/stores/integrations.store'

const { t } = useI18n()
const appService = useAppService()
const { toast } = appService
const integrationService = useIntegrationService()
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

async function handleCardClick(
  integration: IntegrationDefinition,
  config?: IntegrationResponse,
) {
  const isConfigured = !!config
  const formSchema = configSchemas[integration.configSchema]

  // Show our custom IntegrationForm component in a dialog
  const result = await appService.componentDialog({
    component: IntegrationForm,
    props: {
      integration,
      schema: formSchema,
      isConfigured,
      config,
    },
    title: isConfigured
      ? t('settings.integrations.edit', { name: integration.name })
      : t('settings.integrations.configure', { name: integration.name }),
    description: t(`settings.integrations.descriptions.${integration.id}`),
    continueText: t('general.save'),
    cancelText: t('general.cancel'),
  })

  if (result) {
    if (isConfigured) {
      // Update existing integration
      await integrationService.updateIntegration(config.id, {
        config: result.config,
        capabilities: result.capabilities,
      })
    } else {
      // Create new integration with capabilities separated from config
      await integrationService.createIntegration(
        integration.id,
        result.config,
        result.capabilities,
      )
    }

    const successMessage = isConfigured
      ? t('settings.integrations.updated', { name: integration.name })
      : t('settings.integrations.created', { name: integration.name })

    toast.success(t('settings.integrations.success'), {
      description: successMessage,
    })
  }
}

async function deleteIntegration(
  integration: IntegrationDefinition,
  config?: IntegrationResponse,
) {
  if (!config) return

  const confirmed = await appService.confirm({
    title: t('settings.integrations.delete.title'),
    description: t('settings.integrations.delete.description', {
      name: integration.name,
      config: config?.id,
    }),
    continueText: t('general.delete'),
    cancelText: t('general.cancel'),
    destructive: true,
  })

  if (confirmed) {
    try {
      await integrationService.deleteIntegration(config.id)

      toast.success(t('settings.integrations.success'), {
        description: t('settings.integrations.delete.success', {
          name: integration.name,
          config: config?.id,
        }),
      })
    } catch (error) {
      console.error('Failed to delete integration:', error)
      // Error toast will be handled by axios interceptor
    }
  }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div
      v-if="integrationStore.isLoading"
      class="flex justify-center items-center py-10"
    >
      <!-- TODO: Replace with lucide icon loader -->
      <div
        class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
      ></div>
    </div>

    <div v-else>
      <!-- Configured Integrations -->
      <IntegrationsList
        :title="t('settings.integrations.title')"
        :description="t('settings.integrations.description')"
        :integrations="integrationStore.configuredIntegrations"
        :empty-message="t('settings.integrations.noConfigured')"
        @integration-click="handleCardClick"
        @integration-delete="deleteIntegration"
        :configured="true"
      />

      <!-- Available Integrations -->
      <IntegrationsList
        :title="t('settings.integrations.available')"
        :integrations="integrationStore.unconfiguredIntegrations"
        :empty-message="t('settings.integrations.noAvailable')"
        @integration-click="handleCardClick"
        :configured="false"
      />
    </div>
  </div>
</template>
