<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useIntegrationService } from '@/services/integration.service'
import {
  IntegrationDefinition,
  IntegrationRecord,
  IntegrationScheme,
  schemaConfigs,
} from '@/types/integrations.types'
import { ZodObject } from 'zod'
import { AutoForm } from '@/components/ui/auto-form'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { useAppService } from '@/services/app.service'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'
import { TransitionExpand } from '@morev/vue-transitions'
import { useServerUrl } from '@/lib/api'
import { ExternalLinkIcon, ShieldCheckIcon } from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    integration: IntegrationDefinition
    config?: IntegrationRecord
    schema: ZodObject<any>
    isConfigured: boolean
    scheme?: IntegrationScheme
  }>(),
  { scheme: 'server-key' },
)

const emit = defineEmits<{
  (e: 'update:valid', valid: boolean): void
}>()

const { t } = useI18n()
const { toast } = useAppService()
const integrationService = useIntegrationService()
const serverUrl = useServerUrl()
const formRef = ref(null)

const DOCS_BASE = 'https://docs.parchment.app/usage/integrations'

/** Trim all string values in a flat config object */
function trimConfigStrings(config: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {}
  for (const [key, value] of Object.entries(config)) {
    result[key] = typeof value === 'string' ? value.trim() : value
  }
  return result
}

const docsUrl = computed(() => {
  return `${DOCS_BASE}/${props.integration.id}`
})

const isOsmSystemSchema = computed(
  () => props.integration.configSchema === 'openstreetmapSystemSchema',
)

const defaultRedirectUri = computed(() => {
  const base = serverUrl.value
  // OSM requires HTTPS redirect URIs. In dev mode (http://localhost),
  // use https:// so the URI is accepted by OSM for registration.
  // The dev workaround handles the redirect failure.
  const httpsBase = base.replace(/^http:\/\//, 'https://')
  return `${httpsBase}/integrations/osm/callback`
})

const currentSchemaConfig = computed(() =>
  schemaConfigs[props.integration.configSchema] ?? {},
)

interface FormValues {
  config: Record<string, any>
  capabilities: Array<{
    id: string
    active: boolean
  }>
}

const combinedSchema = toTypedSchema(
  z.object({
    config: props.schema,
    capabilities: z.array(
      z.object({
        id: z.string(),
        active: z.boolean(),
      }),
    ),
  }),
)

const { values, meta, setFieldValue, resetForm } = useForm<FormValues>({
  validationSchema: combinedSchema,
  initialValues: {
    config: props.isConfigured ? { ...props.config?.config } : {},
    capabilities:
      props.integration.capabilities?.map(capId => ({
        id: capId,
        active:
          props.isConfigured && props.config?.capabilities
            ? props.config.capabilities.find(cap => cap.id === capId)?.active ??
              false
            : false,
      })) ?? [],
  },
})

const configForm = useForm({
  validationSchema: toTypedSchema(props.schema),
  initialValues: props.isConfigured ? { ...props.config?.config } : {},
})

const isConnectionTested = ref(props.isConfigured)
const isTesting = ref(false)
const testResult = ref<{ success: boolean; message?: string } | null>(
  props.isConfigured ? { success: true } : null,
)

const wasInitiallyActive = computed(
  () =>
    props.isConfigured && props.config?.capabilities?.some(cap => cap.active),
)

const hasConfigChanges = computed(() => {
  if (!props.isConfigured) return configForm.meta.value?.dirty
  return (
    JSON.stringify(props.config?.config) !== JSON.stringify(configForm.values)
  )
})

const isFormValid = computed(
  () =>
    Object.keys(configForm.errors.value).length === 0 &&
    configForm.meta.value?.valid,
)

const isEnabledToggleDisabled = computed(() => {
  if (
    (wasInitiallyActive.value || props.isConfigured) &&
    !hasConfigChanges.value
  ) {
    return false
  }
  return !isConnectionTested.value || !testResult.value?.success
})

const allCapabilitiesEnabled = computed({
  get: () => {
    return values.capabilities.some(cap => cap.active)
  },
  set: (enabled: boolean) => {
    if (values.capabilities) {
      const newCapabilities = values.capabilities.map(cap => ({
        ...cap,
        active: enabled,
      }))
      setFieldValue('capabilities', newCapabilities)
    }
  },
})

const isValid = computed(() => {
  // For already configured integrations without changes or with only capability changes
  if (
    props.isConfigured &&
    (!configForm.meta.value?.dirty || !hasConfigChanges.value)
  ) {
    return isFormValid.value
  }

  // For new integrations or existing ones with config changes, require a successful test
  return (
    isFormValid.value &&
    isConnectionTested.value &&
    testResult.value?.success === true
  )
})

async function validateConfigForm() {
  await configForm.validate()
  updateValidity()
}

function toggleCapability(capability: string, enabled: boolean) {
  const newCapabilities = values.capabilities.map(cap => ({
    ...cap,
    active: cap.id === capability ? enabled : cap.active,
  }))
  setFieldValue('capabilities', newCapabilities)
}

function updateValidity() {
  emit('update:valid', isValid.value)
}

async function testConnection() {
  await validateConfigForm()

  if (!isFormValid.value) {
    toast.error(t('settings.integrations.test.validation_error'))
    return
  }

  isTesting.value = true
  testResult.value = null

  try {
    const result = await integrationService.testIntegrationConfig(
      props.integration.id,
      trimConfigStrings(configForm.values),
    )

    testResult.value = result
    isConnectionTested.value = true

    if (result.success) {
      toast.success(t('settings.integrations.test.success'))
    } else {
      toast.error(result.message || t('settings.integrations.test.failure'))
    }
  } catch (error: any) {
    testResult.value = null
    toast.error(error.toString())
  } finally {
    isTesting.value = false
    updateValidity()
  }
}

async function submit() {
  if (!isValid.value) return null

  return {
    config: trimConfigStrings(configForm.values),
    capabilities: values.capabilities.map(cap => ({
      id: cap.id,
      active: cap.active,
    })),
  }
}

watch(
  () => configForm.values,
  newConfig => {
    setFieldValue('config', newConfig)
    validateConfigForm()
  },
  { deep: true },
)

watch(
  [() => configForm.errors, () => configForm.meta],
  () => updateValidity(),
  { deep: true },
)

watch(
  () => values.config,
  newConfig => {
    // Reset test status if there are config changes
    if (hasConfigChanges.value) {
      isConnectionTested.value = false
      testResult.value = null
      updateValidity()
    }

    if (JSON.stringify(configForm.values) !== JSON.stringify(newConfig)) {
      configForm.setValues(newConfig)
    }

    configForm.validate()
  },
  { deep: true },
)

watch(
  () => props.integration,
  newIntegration => {
    if (props.isConfigured && props.config) {
      configForm.resetForm({ values: { ...props.config.config } })
    }
  },
  { deep: true },
)

watch(
  () => testResult.value?.success,
  success => {
    if (success === true && !allCapabilitiesEnabled.value) {
      allCapabilitiesEnabled.value = true
    }
  },
)

onMounted(() => {
  if (props.isConfigured && props.config) {
    configForm.resetForm({ values: { ...props.config.config } })
    isConnectionTested.value = true
    testResult.value = { success: true }

    // Validate form after mount
    setTimeout(() => {
      validateConfigForm()
    }, 0)
  }

  // Pre-fill default redirect URI for new OSM system integrations
  if (isOsmSystemSchema.value && !props.isConfigured) {
    setTimeout(() => {
      configForm.setFieldValue('redirectUri', defaultRedirectUri.value)
    }, 0)
  }
})

defineExpose({ submit })
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center gap-1.5 text-sm text-muted-foreground">
      <ExternalLinkIcon class="size-3.5 shrink-0" />
      <a
        :href="docsUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="underline hover:text-foreground transition-colors"
      >
        {{ t('settings.integrations.viewDocs') }}
      </a>
    </div>

    <Alert v-if="scheme === 'user-e2ee'" variant="info">
      <ShieldCheckIcon class="size-4" />
      <AlertDescription>
        {{ t('settings.integrations.scheme.endToEnd.formNote') }}
      </AlertDescription>
    </Alert>

    <!-- TODO: Add "show secrets" toggle to text fields -->
    <AutoForm
      ref="formRef"
      :schema="schema"
      :form="configForm"
      :field-config="currentSchemaConfig.fieldConfig"
      :dependencies="currentSchemaConfig.dependencies"
      class="space-y-4"
    />

    <div class="mt-2">
      <div class="flex items-center justify-between">
        <div>
          <div class="block text-sm font-medium text-foreground">
            {{ t('settings.integrations.test.title') }}
          </div>
          <p class="text-sm text-muted-foreground">
            {{ t('settings.integrations.test.description') }}
          </p>
        </div>
        <Button
          size="sm"
          @click="testConnection"
          :loading="isTesting"
          :disabled="!isFormValid"
        >
          {{ t('settings.integrations.test.button') }}
        </Button>
      </div>
    </div>

    <template v-if="integration.capabilities?.length > 0">
      <div class="flex items-center justify-between">
        <div class="block text-sm font-medium text-foreground">
          {{ t('general.enabled') }}
        </div>
        <Switch
          id="capability-all"
          :model-value="allCapabilitiesEnabled"
          @update:model-value="enabled => (allCapabilitiesEnabled = enabled)"
          :disabled="isEnabledToggleDisabled"
        />
      </div>

      <TransitionExpand :duration="300" :delay="150">
        <div class="space-y-2">
          <div class="block text-sm font-medium text-foreground">
            {{ t('settings.integrations.capabilities.title') }}
          </div>
          <div class="space-y-3 p-3 border border-border rounded-md">
            <div
              v-for="capability in values.capabilities"
              :key="capability.id"
              class="flex items-center justify-between"
            >
              <div>
                <Label
                  :for="`capability-${capability.id}`"
                  class="cursor-pointer"
                >
                  {{ t(`settings.integrations.capabilities.${capability.id}`) }}
                </Label>
              </div>
              <Switch
                :id="`capability-${capability.id}`"
                :model-value="capability.active"
                @update:model-value="
                  enabled => toggleCapability(capability.id, enabled)
                "
                :disabled="isEnabledToggleDisabled"
              />
            </div>
          </div>
        </div>
      </TransitionExpand>
    </template>
  </div>
</template>
