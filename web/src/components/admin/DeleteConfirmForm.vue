<script setup lang="ts">
import { ref, watch } from 'vue'
import { Input } from '@/components/ui/input'
import { Code } from '@/components/ui/code'
import CopyButton from '@/components/CopyButton.vue'

const props = defineProps<{
  confirmValue: string
  warning?: string
}>()

const emit = defineEmits<{
  (e: 'update:valid', valid: boolean): void
}>()

const input = ref('')

watch(input, (v) => {
  emit('update:valid', v === props.confirmValue)
}, { immediate: true })

defineExpose({
  submit: () => {
    if (input.value !== props.confirmValue) return false
    return true
  },
})
</script>

<template>
  <div class="flex flex-col gap-3">
    <p v-if="warning" class="text-sm font-medium text-destructive">
      {{ warning }}
    </p>
    <p class="text-sm text-muted-foreground">
      Type
      <span class="inline-flex items-center gap-1 mx-0.5 align-middle">
        <Code>{{ confirmValue }}</Code>
        <CopyButton :text="confirmValue" message="Copied" />
      </span>
      to confirm.
    </p>
    <Input
      v-model="input"
      :placeholder="confirmValue"
    />
  </div>
</template>
