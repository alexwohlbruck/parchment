<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useAppService } from '@/services/app.service'
import { ref, onMounted } from 'vue'
import { useIntegrationService } from '@/services/integration.service'
import { UiIntegration } from '@/types/integrations.types'
import { ZodObject } from 'zod'
import {
  apiKeySchema,
  hostConfigSchema,
  oauthConfigSchema,
  nominatimSchema,
  googleMapsSchema,
} from '@/types/integrations.types'
import IntegrationsList from '@/components/integration/IntegrationsList.vue'
import IntegrationForm from '@/components/integration/IntegrationForm.vue'

const { t } = useI18n()
const appService = useAppService()
const { toast } = appService
const integrationService = useIntegrationService()

const isLoading = ref(false)

// Fetch integrations when component is mounted
onMounted(async () => {
  isLoading.value = true
  try {
    // First fetch available integrations (metadata)
    await integrationService.fetchAvailableIntegrations()

    // Then fetch configured integrations
    await integrationService.fetchConfiguredIntegrations()
  } catch (error) {
    console.error('Failed to load integrations:', error)
  } finally {
    isLoading.value = false
  }
})

async function handleCardClick(integration: UiIntegration) {
  const isConfigured = integration.status === 'active'
  // Use the integration's type ID for lookups (integrationId for configured, id for available)
  const integrationTypeId = integration.integrationId || integration.id

  try {
    // Map the schema name to the actual schema object
    const schemaMap: Record<string, ZodObject<any>> = {
      apiKeySchema,
      hostConfigSchema,
      oauthConfigSchema,
      nominatimSchema,
      googleMapsSchema,
    }

    // Get the actual schema based on the schema name or use apiKeySchema as fallback
    let formSchema: ZodObject<any>
    if (typeof integration.configSchema === 'string') {
      formSchema = schemaMap[integration.configSchema] || apiKeySchema
    } else {
      formSchema = integration.configSchema || apiKeySchema
    }

    // Show our custom IntegrationForm component in a dialog
    const result = await appService.componentDialog({
      component: IntegrationForm,
      props: {
        integration,
        schema: formSchema,
        isConfigured,
      },
      title: isConfigured
        ? t('settings.integrations.edit', { name: integration.name })
        : t('settings.integrations.configure', { name: integration.name }),
      description: t(`settings.integrations.descriptions.${integrationTypeId}`),
      continueText: t('general.save'),
      cancelText: t('general.cancel'),
    })

    if (result) {
      try {
        if (isConfigured) {
          // Update existing integration
          await integrationService.updateIntegration(integration.id, {
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
      } catch (error) {
        console.error('Integration operation failed:', error)
        toast.error(t('settings.integrations.error'), {
          description: error as string,
        })
      }
    }
  } catch (error) {
    console.error('Form dialog error:', error)
  }
}

async function deleteIntegration(integration: UiIntegration) {
  const confirmed = await appService.confirm({
    title: t('settings.integrations.delete.title'),
    description: t('settings.integrations.delete.description', {
      name: integration.name,
    }),
    continueText: t('general.delete'),
    cancelText: t('general.cancel'),
    destructive: true,
  })

  if (confirmed) {
    try {
      await integrationService.deleteIntegration(integration.id)

      toast.success(t('settings.integrations.success'), {
        description: t('settings.integrations.delete.success', {
          name: integration.name,
        }),
      })
    } catch (error) {
      console.error('Failed to delete integration:', error)
      toast.error(t('settings.integrations.error'), {
        description: error as string,
      })
    }
  }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div v-if="isLoading" class="flex justify-center items-center py-10">
      <div
        class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
      ></div>
    </div>

    <div v-else>
      <!-- Configured Integrations -->
      <IntegrationsList
        :title="t('settings.integrations.title')"
        :description="t('settings.integrations.description')"
        :integrations="integrationService.configuredIntegrations.value"
        :empty-message="t('settings.integrations.noConfigured')"
        @integration-click="handleCardClick"
        @integration-delete="deleteIntegration"
      />

      <!-- Available Integrations -->
      <IntegrationsList
        :title="t('settings.integrations.available')"
        :integrations="integrationService.availableIntegrations.value"
        :empty-message="t('settings.integrations.noAvailable')"
        @integration-click="handleCardClick"
      />
    </div>
  </div>
</template>
