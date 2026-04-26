<script setup lang="ts">
import { Card } from '@/components/ui/card'
import { useI18n } from 'vue-i18n'
import { cn } from '@/lib/utils'
import { CloudIcon, HardDriveIcon, UserIcon, LogOutIcon } from 'lucide-vue-next'
import {
  Integration,
  IntegrationDefinition,
  IntegrationId,
  IntegrationRecord,
  IntegrationScheme,
  IntegrationScope,
} from '@/types/integrations.types'
import { computed, h } from 'vue'
import { storeToRefs } from 'pinia'
import { Button } from '@/components/ui/button'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { useIdentityStore } from '@/stores/identity.store'
import { useAppService } from '@/services/app.service'
import { useIntegrationService } from '@/services/integration.service'
import { configSchemas } from '@/types/integrations.types'
import IntegrationForm from '@/components/integration/IntegrationForm.vue'
import OsmConnectedAccount from '@/components/integration/OsmConnectedAccount.vue'
import { api } from '@/lib/api'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

const { t } = useI18n()
const integrationsStore = useIntegrationsStore()
const identityStore = useIdentityStore()
const { isSetupComplete } = storeToRefs(identityStore)
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
}>()

function getInitial(name: string): string {
  return name[0].toUpperCase()
}

// Which scheme the Configure slot uses. Phase 1 supports single-scheme
// integrations only (Dawarich = user-e2ee, everything else = server-key).
// Two-slot rendering will land when a dual-scheme integration ships.
const activeScheme = computed<IntegrationScheme>(() => {
  const supported = props.integration.supportedSchemes ?? ['server-key']
  return supported[0] ?? 'server-key'
})

// Block Configure on user-e2ee tiles until identity setup is done — the
// personal key derives from the seed, and without it we can't encrypt.
const requiresSetup = computed(
  () => activeScheme.value === 'user-e2ee' && !isSetupComplete.value,
)

const tileDisabled = computed(() => props.disabled || requiresSetup.value)

async function handleOAuthClick() {
  const integration = props.integration
  const config = props.configuration
  const isConfigured = !!config

  if (!isConfigured) {
    // Open OAuth authorization in a popup/new tab
    try {
      const response = await api.get('/integrations/osm/authorize')
      const { url } = response.data

      const isDevMode = window.location.protocol === 'http:'

      if (isDevMode) {
        // Dev mode: OSM doesn't allow HTTP redirect URIs, so provide a console-based workaround.
        // Open the auth URL - the redirect will fail, but the user can copy the URL from the browser.
        window.open(url, '_blank')

        // Register a global callback for the dev workaround
        ;(window as any).__osmDevCallback = async (redirectUrl: string) => {
          try {
            const parsedUrl = new URL(redirectUrl)
            const code = parsedUrl.searchParams.get('code')
            const state = parsedUrl.searchParams.get('state')

            if (!code || !state) {
              console.error(
                'Missing code or state in URL. Make sure you copied the full URL.',
              )
              return
            }

            // Call the callback endpoint directly - it returns HTML but the server-side
            // still performs the token exchange and creates the integration record
            const response = await api.get('/integrations/osm/callback', {
              params: { code, state },
              // Accept any response type since it returns HTML
              transformResponse: [(data: any) => data],
            })

            // Parse the HTML response to check for success/error
            const html = response.data as string
            if (html.includes('"status":"error"')) {
              const msgMatch = html.match(/"message":"([^"]*)"/)
              const errorMsg = msgMatch?.[1] || 'OAuth callback failed'
              console.error(
                `%c❌ ${errorMsg}`,
                'color: red; font-weight: bold;',
              )
              toast.error(errorMsg)
              return
            }

            toast.success(t('settings.integrations.osm.connected'))
            await integrationService.fetchConfiguredIntegrations()
            await integrationService.fetchAvailableIntegrations()

            delete (window as any).__osmDevCallback
            console.log(
              '%c✅ OSM account connected successfully!',
              'color: green; font-weight: bold;',
            )
          } catch (error: any) {
            console.error('Dev OAuth callback failed:', error)
            toast.error(
              error.message || t('settings.integrations.osm.authError'),
            )
          }
        }

        console.log(
          '%c🔑 OSM OAuth Dev Mode',
          'font-weight: bold; font-size: 14px;',
        )
        console.log(
          'After authorizing on OSM, the redirect will fail because the\n' +
            'redirect URI uses HTTPS but your local server runs on HTTP.\n\n' +
            'Copy the full URL from the browser address bar (it will contain\n' +
            '?code=...&state=... parameters) and run:\n\n' +
            "  window.__osmDevCallback('PASTE_FULL_URL_HERE')\n",
        )

        toast.info(t('settings.integrations.osm.devCallbackInstructions'))
      } else {
        const popup = window.open(
          url,
          'osm-oauth',
          'width=600,height=700,popup=yes',
        )

        // Listen for the callback postMessage from the popup
        const expectedOrigin = new URL(api.defaults.baseURL as string).origin
        const onMessage = async (event: MessageEvent) => {
          if (event.data?.type !== 'osm-oauth-callback') return
          if (event.origin !== expectedOrigin) return
          window.removeEventListener('message', onMessage)

          if (event.data.status === 'connected') {
            toast.success(t('settings.integrations.osm.connected'))
            await integrationService.fetchConfiguredIntegrations()
            await integrationService.fetchAvailableIntegrations()
          } else {
            toast.error(
              event.data.message || t('settings.integrations.osm.authError'),
            )
          }
        }

        window.addEventListener('message', onMessage)

        // Clean up listener if popup is closed without completing
        const checkClosed = setInterval(() => {
          if (popup?.closed) {
            clearInterval(checkClosed)
            window.removeEventListener('message', onMessage)
          }
        }, 500)
      }
    } catch (error) {
      console.error('Failed to initiate OAuth flow:', error)
      toast.error(t('settings.integrations.osm.authError'))
    }
    return
  }

  // Show connected account dialog
  const dialogResult = await appService.componentDialog({
    component: OsmConnectedAccount,
    props: {
      integration,
      config,
    },
    footerPrepend: () =>
      h(
        Button,
        {
          variant: 'destructive-outline',
          size: 'sm',
          onClick: () => handleDisconnect(integration, config),
        },
        () => [
          h(LogOutIcon, { class: 'size-4 mr-1' }),
          t('settings.integrations.osm.disconnect'),
        ],
      ),
    title: t('settings.integrations.edit', { name: integration.name }),
    description: t(`settings.integrations.descriptions.${integration.id}`),
    continueText: t('general.save'),
    cancelText: t('general.cancel'),
    onContinue: async formData => {
      if (!formData) return false
      try {
        await integrationService.updateIntegration(config.id, {
          capabilities: formData.capabilities,
        })
        return true
      } catch (error) {
        console.error('Failed to update integration:', error)
        return false
      }
    },
  })

  if (dialogResult) {
    toast.success(t('settings.integrations.success'), {
      description: t('settings.integrations.updated', {
        name: integration.name,
      }),
    })
  }
}

async function handleClick() {
  if (props.disabled) return

  const integration = props.integration

  if (requiresSetup.value) {
    toast.warning(t('settings.integrations.scheme.setupRequired'))
    return
  }

  // OAuth integrations use a different flow
  if (integration.authType === 'oauth2') {
    return handleOAuthClick()
  }

  const config = props.configuration
  const isConfigured = !!config
  const formSchema = configSchemas[integration.configSchema]

  if (!formSchema) {
    console.error(`Schema not found for ${integration.configSchema}`)
    toast.error(`Configuration schema not found for ${integration.name}`)
    return
  }

  // When editing a server-key integration, fetch the full decrypted config
  // via the detail endpoint. For user-e2ee rows the plaintext is already in
  // the store — hydrated client-side on sign-in.
  let fullConfig: IntegrationRecord | undefined = config
  if (isConfigured && config && activeScheme.value === 'server-key') {
    try {
      const response = await api.get<IntegrationRecord>(
        `/integrations/${config.id}`,
      )
      fullConfig = response.data
    } catch (err) {
      console.error('Failed to fetch full integration config:', err)
      toast.error('Failed to load integration configuration')
      return
    }
  }

  // Show our custom IntegrationForm component in a dialog
  const dialogResult = await appService.componentDialog({
    component: IntegrationForm,
    props: {
      integration,
      schema: formSchema,
      isConfigured,
      config: fullConfig,
      scheme: activeScheme.value,
    },
    footerPrepend: isConfigured
      ? () =>
          h(
            Button,
            {
              variant: 'destructive-outline',
              size: 'sm',
              onClick: () => handleDisconnect(integration, config),
            },
            () => [
              h(LogOutIcon, { class: 'size-4 mr-1' }),
              t('settings.integrations.osm.disconnect'),
            ],
          )
      : undefined,
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
          // Create new integration with capabilities separated from config.
          // For user-e2ee the service POSTs metadata + saveBlob (rollback on fail).
          await integrationService.createIntegration(
            integration.id,
            formData.config,
            formData.capabilities,
            activeScheme.value,
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

async function handleDisconnect(
  integration: IntegrationDefinition,
  config: IntegrationRecord,
) {
  // Check for dependent integrations before deleting
  let dependents: {
    id: string
    integrationId: string
    userId: string | null
    name: string
  }[] = []
  try {
    const response = await api.get(`/integrations/${config.id}/dependents`)
    dependents = response.data
  } catch {
    // If we can't check dependents (e.g. no permission), proceed with basic confirm
  }

  let description = t('settings.integrations.disconnect.description', {
    name: integration.name,
  })

  if (dependents.length > 0) {
    const names = [...new Set(dependents.map(d => d.name))].join(', ')
    description +=
      '\n\n' +
      t('settings.integrations.disconnect.dependentsWarning', {
        count: dependents.length,
        names,
      })
  }

  const confirmed = await appService.confirm({
    title: t('settings.integrations.disconnect.title'),
    description,
    continueText: t('settings.integrations.osm.disconnect'),
    cancelText: t('general.cancel'),
    destructive: true,
    onContinue: async () => {
      try {
        await integrationService.deleteIntegration(config.id)
        toast.success(t('settings.integrations.success'), {
          description: t('settings.integrations.disconnect.success', {
            name: integration.name,
          }),
        })
        window.location.reload()
        return true
      } catch (error) {
        console.error('Failed to disconnect integration:', error)
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

const statusColors = computed(() => {
  if (!props.configuration) {
    return {
      bg: '#FCA5A5',
      border: '#EF4444',
      label: t('settings.integrations.filter.notConnected'),
    }
  }
  if (!isIntegrationEnabled.value) {
    return {
      bg: '#FDE68A',
      border: '#EAB308',
      label: t('settings.integrations.filter.disabled'),
    }
  }
  return {
    bg: '#80FFA4',
    border: '#57D17A',
    label: t('settings.integrations.filter.connected'),
  }
})

const icon = computed(() => {
  return integrationsStore.getIcon(props.integration.id)
})
</script>

<template>
  <Card
    :class="
      cn(
        'flex flex-col gap-3 hover:bg-muted/50 transition-colors cursor-pointer relative',
        tileDisabled && 'opacity-60 cursor-not-allowed',
      )
    "
    @click="handleClick"
  >
    <div class="flex items-start justify-between pt-4 px-4">
      <div class="relative">
        <div
          class="integration-icon size-12 flex items-center justify-center rounded-lg shadow-xs border"
          :style="`--integration-color: ${integration.color}`"
        >
          <svg
            v-if="icon"
            class="integration-icon-fg size-7"
            viewBox="0 0 24 24"
            fill="currentColor"
            v-html="icon.svg"
          />
          <span v-else class="integration-icon-fg font-medium text-lg">
            {{ getInitial(integration.name) }}
          </span>
        </div>
      </div>
      <TooltipProvider>
        <div class="flex gap-1 items-center">
          <Tooltip v-if="integration.paid">
            <TooltipTrigger as-child>
              <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 font-semibold">
                $
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" :side-offset="4">
              {{ t('settings.integrations.filter.paid') }}
            </TooltipContent>
          </Tooltip>
          <Tooltip v-if="integration.cloud">
            <TooltipTrigger as-child>
              <span class="text-[10px] p-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 font-semibold flex items-center gap-0.5">
                <CloudIcon class="size-3" />
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" :side-offset="4">
              {{ t('settings.integrations.filter.cloud') }}
            </TooltipContent>
          </Tooltip>
          <Tooltip v-if="integration.scope">
            <TooltipTrigger as-child>
              <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 font-semibold flex items-center gap-0.5">
                <UserIcon
                  v-if="integration.scope.includes(IntegrationScope.USER)"
                  class="size-3"
                />
                <HardDriveIcon
                  v-if="integration.scope.includes(IntegrationScope.SYSTEM)"
                  class="size-3"
                />
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" :side-offset="4">
              {{ integration.scope.map(s => t(`settings.integrations.filter.${s}`)).join(', ') }}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <span
                class="size-2 rounded-full border-[1.75px]"
                :style="{
                  backgroundColor: statusColors.bg,
                  borderColor: statusColors.border,
                }"
              />
            </TooltipTrigger>
            <TooltipContent side="top" :side-offset="4">
              {{ statusColors.label }}
            </TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </div>
    <div class="px-4 flex-1">
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
    </div>
    <div
      v-if="integration.capabilities?.length > 0"
      class="bg-muted/50 border-t border-border mt-auto"
    >
      <div
        class="flex flex-nowrap gap-2 px-2 py-3 overflow-x-auto scrollbar-hidden"
      >
        <span
          v-for="capability in integration.capabilities"
          :key="capability"
          :class="[
            'text-xs px-2 py-0.5 rounded-full font-medium inline-flex items-center whitespace-nowrap shrink-0',
            isCapabilityEnabled(capability)
              ? 'bg-primary-100 text-primary-800 dark:bg-primary-800 dark:text-primary-200'
              : 'bg-muted text-muted-foreground',
          ]"
        >
          {{ t(`settings.integrations.capabilities.${capability}`) }}
        </span>
      </div>
    </div>
  </Card>
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
