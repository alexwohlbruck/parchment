<script setup lang="ts">
/**
 * A style colour. The swatch covers the common case in one click; the text
 * field beside it stays authoritative because the style spec allows values
 * the native picker cannot express — `rgba(…)` with alpha, `hsl(…)`, and the
 * transparent default several halo properties ship with.
 */
import { computed } from 'vue'
import { Input } from '@/components/ui/input'

const props = defineProps<{
  modelValue?: string
  placeholder?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

/** `<input type="color">` only speaks `#rrggbb`, so anything else falls back. */
const swatchValue = computed(() => {
  const value = props.modelValue ?? props.placeholder ?? ''
  return /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'
})

const isTransparent = computed(
  () => /^(transparent|rgba\([^)]*,\s*0\s*\))$/i.test(props.modelValue ?? ''),
)
</script>

<template>
  <div class="flex items-center gap-1.5">
    <div
      class="relative size-7 shrink-0 rounded-md border overflow-hidden"
      :class="isTransparent && 'bg-[repeating-conic-gradient(theme(colors.muted)_0_25%,transparent_0_50%)] bg-[length:8px_8px]'"
    >
      <div
        class="absolute inset-0"
        :style="{ background: modelValue || placeholder || 'transparent' }"
      />
      <input
        type="color"
        :value="swatchValue"
        class="absolute inset-0 opacity-0 cursor-pointer"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      />
    </div>
    <Input
      :model-value="modelValue ?? ''"
      :placeholder="placeholder"
      class="h-7 w-24 font-mono text-xs"
      @update:model-value="value => emit('update:modelValue', String(value))"
    />
  </div>
</template>
