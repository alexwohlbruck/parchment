<script setup lang="ts">
import { type HTMLAttributes, computed, ref } from 'vue'
import { Search } from 'lucide-vue-next'
import {
  ComboboxInput,
  type ComboboxInputProps,
  useForwardProps,
} from 'radix-vue'
import { cn } from '@/lib/utils'

defineOptions({
  inheritAttrs: false,
})

const props = defineProps<
  ComboboxInputProps & {
    class?: HTMLAttributes['class']
    modelValue: string
  }
>()

const emits = defineEmits<{
  'update:modelValue': any
}>()

const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props
  return delegated
})

const forwardedProps = useForwardProps(delegatedProps)

const input = ref<InstanceType<typeof ComboboxInput> | null>(null)
const inputElement = computed(() => input.value?.$el as HTMLInputElement | null)

defineExpose({ inputElement })
</script>

<template>
  <div
    class="flex items-center border-b dark:border-neutral-900 px-3"
    cmdk-input-wrapper
  >
    <Search class="mr-2 h-4 w-4 shrink-0 opacity-50" />
    <ComboboxInput
      ref="input"
      v-bind="{ ...forwardedProps, ...$attrs }"
      :value="props.modelValue"
      @input="$event => $emit('update:modelValue', $event.target.value)"
      autofocus="false"
      :class="
        cn(
          'flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
          props.class,
        )
      "
    />
    <slot />
  </div>
</template>
