<script setup lang="ts">
import { computed } from 'vue'
import { AutoForm } from '@/components/ui/auto-form'
import { apiKeySchema } from '@/types/integrations.types'
import type { Integration } from '@/types/integrations.types'

const props = defineProps<{
  integration: Integration
  isConfigured: boolean
}>()

const emit = defineEmits(['update:valid'])

const schema = computed(() => props.integration.configSchema || apiKeySchema)

const defaultValues = computed(() => {
  return {
    enabled: props.isConfigured,
  }
})

async function submit(values: any) {
  return values
}

defineExpose({
  submit,
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <AutoForm
      :schema="schema"
      :initial-values="defaultValues"
      @submit="submit"
      class="space-y-4"
    />
  </div>
</template>
