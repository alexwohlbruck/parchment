<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useIntegrationService } from '@/services/integration.service'
import { UiIntegration } from '@/types/integrations.types'
import { ZodObject } from 'zod'
import { AutoForm } from '@/components/ui/auto-form'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { useAppService } from '@/services/app.service'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'
import { TransitionExpand } from '@morev/vue-transitions'

const props = defineProps<{
  integration: UiIntegration
  schema: ZodObject<any>
  isConfigured: boolean
}>()

const emit = defineEmits<{
  (e: 'update:valid', valid: boolean): void
}>()

const { t } = useI18n()
const { toast } = useAppService()
const integrationService = useIntegrationService()

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

const { values, meta, setFieldValue, resetForm, errors } = useForm<FormValues>({
  validationSchema: combinedSchema,
  initialValues: {
    config: props.isConfigured ? { ...props.integration.config } : {},
    capabilities:
      props.integration.capabilities?.map(capId => ({
        id: capId,
        active:
          props.isConfigured && props.integration.capabilityRecords
            ? props.integration.capabilityRecords.find(cap => cap.id === capId)
                ?.active ?? false
            : false,
      })) ?? [],
  },
})

const configForm = useForm({
  validationSchema: toTypedSchema(props.schema),
  initialValues: props.isConfigured ? { ...props.integration.config } : {},
})

const isConnectionTested = ref(false)
const isTesting = ref(false)
const testResult = ref<{ success: boolean; message?: string } | null>(null)
const formRef = ref()

// Computed properties
const wasInitiallyActive = computed(
  () => props.isConfigured && props.integration.enabled,
)

const isEnabledToggleDisabled = computed(
  () =>
    !wasInitiallyActive.value &&
    (!isConnectionTested.value || !testResult.value?.success),
)

const allCapabilitiesEnabled = computed({
  get: () => {
    if (!props.integration.capabilities?.length) return false
    return values.capabilities.some(cap => cap.active)
  },
  set: (enabled: boolean) => {
    if (props.integration.capabilities) {
      const newCapabilities = values.capabilities.map(cap => ({
        ...cap,
        active: enabled,
      }))
      setFieldValue('capabilities', newCapabilities)
    }
  },
})

const isFormValid = computed(
  () =>
    Object.keys(configForm.errors.value).length === 0 &&
    configForm.meta.value?.valid,
)

const isValid = computed(() => {
  // For already configured integrations, consider it valid if form is valid (no validation errors)
  if (props.isConfigured && !configForm.meta.value?.dirty) {
    return isFormValid.value
  }

  // For new integrations or when changes have been made, require a successful test
  return (
    isFormValid.value &&
    isConnectionTested.value &&
    testResult.value?.success === true
  )
})

// Watchers
watch(
  () => configForm.values,
  newConfig => setFieldValue('config', newConfig),
  { deep: true },
)

watch(
  [() => configForm.errors.value, () => configForm.meta.value],
  () => updateValidity(),
  { deep: true },
)

watch(
  () => values.config,
  newConfig => {
    if (isConnectionTested.value) {
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
    if (props.isConfigured && newIntegration.config) {
      configForm.resetForm({ values: { ...newIntegration.config } })
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

// Methods
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
  const isValid = await configForm.validate()
  if (!isValid) return

  isTesting.value = true
  testResult.value = null

  try {
    const result = await integrationService.testIntegrationConfig(
      props.integration.id,
      configForm.values,
    )

    testResult.value = result
    isConnectionTested.value = true

    if (result.success) {
      toast.success(t('settings.integrations.test.success'))
    } else {
      toast.error(result.message || t('settings.integrations.test.failure'))
    }
  } catch (error: any) {
    testResult.value = {
      success: false,
      message: error.toString(),
    }
    toast.error(error.toString())
  } finally {
    isTesting.value = false
    updateValidity()
  }
}

async function submit() {
  if (!isValid.value) return null
  return { ...configForm.values }
}

onMounted(() => {
  if (props.isConfigured && props.integration.config) {
    configForm.resetForm({ values: { ...props.integration.config } })
  }
})

defineExpose({ submit })
</script>

<template>
  <div class="space-y-6">
    <AutoForm
      ref="formRef"
      :schema="schema"
      :form="configForm"
      class="space-y-4"
    />

    <TransitionExpand :duration="300">
      <div
        v-if="
          (!isConnectionTested || !testResult?.success) &&
          configForm.meta.value?.dirty
        "
        class="mt-2"
      >
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
    </TransitionExpand>

    <div class="flex items-center justify-between">
      <div class="block text-sm font-medium text-foreground">
        {{ t('general.enabled') }}
      </div>
      <Switch
        id="capability-all"
        :checked="allCapabilitiesEnabled"
        @update:checked="enabled => (allCapabilitiesEnabled = enabled)"
        :disabled="isEnabledToggleDisabled"
      />
    </div>

    <TransitionExpand :duration="300" :delay="150">
      <div
        v-if="integration.capabilities?.length > 0 && allCapabilitiesEnabled"
        class="space-y-2"
      >
        <div class="block text-sm font-medium text-foreground">
          {{ t('settings.integrations.capabilities.title') }}
        </div>
        <div class="space-y-3 p-3 border rounded-md">
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
              :checked="capability.active"
              @update:checked="
                checked => toggleCapability(capability.id, checked)
              "
            />
          </div>
        </div>
      </div>
    </TransitionExpand>
  </div>
</template>
