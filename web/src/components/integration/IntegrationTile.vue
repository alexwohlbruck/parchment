<script setup lang="ts">
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useI18n } from 'vue-i18n'
import { cn } from '@/lib/utils'
import { CloudIcon, HardDriveIcon, Trash2Icon, UserIcon } from 'lucide-vue-next'
import {
  Integration,
  IntegrationDefinition,
  IntegrationId,
  IntegrationRecord,
  IntegrationScope,
} from '@/types/integrations.types'
import { computed } from 'vue'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { useAppService } from '@/services/app.service'
import { useIntegrationService } from '@/services/integration.service'
import { configSchemas } from '@/types/integrations.types'
import IntegrationForm from '@/components/integration/IntegrationForm.vue'

const { t } = useI18n()
const integrationsStore = useIntegrationsStore()
const appService = useAppService()
const { toast } = appService
const integrationService = useIntegrationService()

const props = defineProps<{
  integration: IntegrationDefinition
  configuration?: IntegrationRecord
  disabled?: boolean
}>()

const emit = defineEmits<{
  (
    e: 'click',
    integration: IntegrationDefinition,
    config?: IntegrationRecord,
  ): void
  (
    e: 'delete',
    integration: IntegrationDefinition,
    config?: IntegrationRecord,
  ): void
}>()

function getInitial(name: string): string {
  return name[0].toUpperCase()
}

async function handleClick() {
  if (props.disabled) return

  const integration = props.integration
  const config = props.configuration
  const isConfigured = !!config
  const formSchema = configSchemas[integration.configSchema]

  // Show our custom IntegrationForm component in a dialog
  const dialogResult = await appService.componentDialog({
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
    onContinue: async formData => {
      // formData is the 'result' from before
      if (!formData) return false
      try {
        if (isConfigured) {
          // Update existing integration
          await integrationService.updateIntegration(config.id, {
            config: formData.config,
            capabilities: formData.capabilities,
          })
        } else {
          // Create new integration with capabilities separated from config
          await integrationService.createIntegration(
            integration.id,
            formData.config,
            formData.capabilities,
          )
        }
        return true // Indicate success
      } catch (error) {
        console.error('Failed to save integration:', error)
        // The error toast is likely handled by an interceptor, but we can show one here too if needed.
        return false // Indicate failure
      }
    },
  })

  if (dialogResult) {
    const successMessage = isConfigured
      ? t('settings.integrations.updated', { name: integration.name })
      : t('settings.integrations.created', { name: integration.name })

    toast.success(t('settings.integrations.success'), {
      description: successMessage,
    })
  }
}

async function handleDelete(event: Event) {
  if (props.disabled) return
  // Stop event propagation to prevent the card click handler from firing
  event.stopPropagation()
  const integration = props.integration
  const config = props.configuration

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
    onContinue: async () => {
      try {
        await integrationService.deleteIntegration(config.id)
        toast.success(t('settings.integrations.success'), {
          description: t('settings.integrations.delete.success', {
            name: integration.name,
            config: config?.id,
          }),
        })
        return true
      } catch (error) {
        console.error('Failed to delete integration:', error)
        return false
      }
    },
  })
}

function isCapabilityEnabled(capability: string): boolean {
  if (props.configuration?.capabilities) {
    return props.configuration.capabilities.some(
      cap => cap.id === capability && cap.active,
    )
  }

  return false
}

const isIntegrationEnabled = computed(() => {
  if (!props.configuration) return true

  if (props.integration.capabilities.length === 0) return true

  return props.integration.capabilities.some(isCapabilityEnabled)
})

const icon = computed(() => {
  return integrationsStore.getIcon(props.integration.id)
})
</script>

<template>
  <Card
    :class="
      cn('p-4 hover:bg-muted/50 transition-colors cursor-pointer relative', {
        grayscale: !isIntegrationEnabled,
      })
    "
    @click="handleClick"
  >
    <div class="flex flex-col gap-3">
      <div class="flex items-start justify-between">
        <div
          class="size-12 flex items-center justify-center rounded-lg shadow-md"
          :style="{ backgroundColor: integration.color }"
        >
          <svg
            v-if="icon"
            class="size-7 text-white"
            viewBox="0 0 24 24"
            fill="currentColor"
            v-html="icon.svg"
          />
          <span v-else class="text-white font-medium text-lg">
            {{ getInitial(integration.name) }}
          </span>
        </div>
        <div class="flex gap-1 items-center">
          <span
            v-if="integration.paid"
            class="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 font-semibold"
          >
            $
          </span>
          <span
            v-if="integration.cloud"
            class="text-[10px] p-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 font-semibold flex items-center gap-0.5"
          >
            <CloudIcon class="size-3" />
          </span>
          <span
            v-if="integration.scope"
            class="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 font-semibold flex items-center gap-0.5"
          >
            <UserIcon
              v-if="integration.scope.includes(IntegrationScope.USER)"
              class="size-3"
            />
            <HardDriveIcon
              v-if="integration.scope.includes(IntegrationScope.SYSTEM)"
              class="size-3"
            />
          </span>
          <Button
            v-if="configuration && !disabled"
            variant="outline"
            size="icon"
            class="ml-1 size-6 text-red-500 hover:text-red-600 hover:bg-red-100 dark:hover:bg-red-950"
            @click="handleDelete"
          >
            <Trash2Icon class="size-3" />
          </Button>
        </div>
      </div>
      <div>
        <h4 class="font-medium">{{ integration.name }}</h4>
        <p class="text-sm text-muted-foreground line-clamp-2">
          {{
            t(
              `settings.integrations.descriptions.${
                configuration?.integrationId || integration.id
              }`,
            )
          }}
        </p>
        <div class="flex flex-wrap gap-1 mt-2">
          <span
            v-for="capability in integration.capabilities"
            :key="capability"
            class="text-xs px-2 py-0.5 rounded-full bg-primary/5 text-primary font-semibold inline-flex items-center gap-1"
          >
            <svg
              v-if="isCapabilityEnabled(capability)"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              width="12"
              height="12"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="size-3"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
            {{ t(`settings.integrations.capabilities.${capability}`) }}
          </span>
        </div>
      </div>
    </div>
  </Card>
</template>
