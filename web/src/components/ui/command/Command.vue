<script setup lang="ts">
import type { ComboboxRootEmits, ComboboxRootProps } from 'reka-ui'
import { ComboboxRoot, useForwardPropsEmits } from 'reka-ui'
import { ref } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<ComboboxRootProps>()
const emits = defineEmits<ComboboxRootEmits>()

const forwarded = useForwardPropsEmits(props, emits)

const root = ref<{ highlightFirstItem?: () => void }>()

defineExpose({
  highlightFirstItem: () => root.value?.highlightFirstItem?.(),
})
</script>

<template>
  <ComboboxRoot
    ref="root"
    v-bind="forwarded"
    :class="
      cn(
        'flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground',
        $attrs.class ?? '',
      )
    "
  >
    <slot />
  </ComboboxRoot>
</template>
