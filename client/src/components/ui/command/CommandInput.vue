<script setup lang="ts">
import { ComboboxInput, type ComboboxInputProps } from 'radix-vue'
import { cn } from '@/lib/utils'
import { computed, ref } from 'vue'

const props = defineProps<ComboboxInputProps>()

const input = ref<InstanceType<typeof ComboboxInput> | null>(null)
const inputElement = computed(() => input.value?.$el as HTMLInputElement | null)

defineExpose({
  inputElement,
})
</script>

<script lang="ts">
export default {
  inheritAttrs: false,
}
</script>

<template>
  <div
    class="flex items-center border-b border-border px-3 gap-2"
    cmdk-input-wrapper
  >
    <slot name="prefix" />

    <ComboboxInput
      ref="input"
      v-bind="{ ...props, ...$attrs }"
      :autofocus="false"
      :class="
        cn(
          'flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
          $attrs.class ?? '',
        )
      "
    />
    <slot name="postfix" />
  </div>
</template>
