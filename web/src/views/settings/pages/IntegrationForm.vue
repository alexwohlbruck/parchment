<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

const props = defineProps<{
  integration: {
    id: string
    name: string
    description: string
    icon: any
    color: string
    status?: string
  }
  isConfigured: boolean
}>()

const emit = defineEmits(['update:valid'])

const { t } = useI18n()
const apiKey = ref('')
const isEnabled = ref(props.isConfigured)

// Example validation - in a real app, this would be more complex
const isValid = ref(props.isConfigured || apiKey.value.length > 0)

// Watch for changes to update validity
watch([apiKey, isEnabled], () => {
  isValid.value =
    isEnabled.value && (props.isConfigured || apiKey.value.length > 0)
  emit('update:valid', isValid.value)
})

// Function to handle form submission
async function submit() {
  return {
    apiKey: apiKey.value,
    isEnabled: isEnabled.value,
  }
}

defineExpose({
  submit,
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between">
      <Label>{{ t('settings.integrations.enabled') }}</Label>
      <Switch v-model="isEnabled" />
    </div>

    <div class="flex flex-col gap-2">
      <Label for="apiKey">{{ t('settings.integrations.apiKey') }}</Label>
      <Input
        id="apiKey"
        v-model="apiKey"
        type="password"
        :placeholder="t('settings.integrations.apiKeyPlaceholder')"
      />
    </div>
  </div>
</template>
