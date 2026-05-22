<script setup lang="ts">
import { ref, watch } from 'vue'
import { Input } from '@/components/ui/input'
import { Caption } from '@/components/ui/typography'
import { Code } from '@/components/ui/code'

const props = defineProps<{
  confirmValue: string
  label?: string
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
  <div class="flex flex-col gap-2">
    <Caption>{{ label ?? 'Type the following to confirm:' }}</Caption>
    <Code class="text-sm">{{ confirmValue }}</Code>
    <Input v-model="input" :placeholder="confirmValue" class="mt-1" />
  </div>
</template>
