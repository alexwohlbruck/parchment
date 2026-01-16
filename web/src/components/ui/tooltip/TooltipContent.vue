<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import {
  TooltipArrow,
  TooltipContent,
  type TooltipContentEmits,
  type TooltipContentProps,
  TooltipPortal,
  useForwardPropsEmits,
} from 'reka-ui'
import { cn } from '@/lib/utils'

defineOptions({
  inheritAttrs: false,
})

const props = withDefaults(
  defineProps<TooltipContentProps & { class?: HTMLAttributes['class'] }>(),
  {
    sideOffset: 4,
  },
)

const emits = defineEmits<TooltipContentEmits>()

const delegatedProps = reactiveOmit(props, 'class')
const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <TooltipPortal>
    <TooltipContent
      data-slot="tooltip-content"
      v-bind="{ ...forwarded, ...$attrs }"
      :class="
        cn(
          'bg-primary-50 dark:bg-primary-950 text-primary-900 dark:text-primary-100 animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit rounded-md px-3 py-1.5 text-xs text-balance',
          '[filter:drop-shadow(1px_0_0_var(--color-primary-200))_drop-shadow(-1px_0_0_var(--color-primary-200))_drop-shadow(0_1px_0_var(--color-primary-200))_drop-shadow(0_-1px_0_var(--color-primary-200))]',
          'dark:[filter:drop-shadow(1px_0_0_var(--color-primary-900))_drop-shadow(-1px_0_0_var(--color-primary-900))_drop-shadow(0_1px_0_var(--color-primary-900))_drop-shadow(0_-1px_0_var(--color-primary-900))]',
          props.class,
        )
      "
    >
      <slot />

      <TooltipArrow class="fill-primary-50 dark:fill-primary-950" />
    </TooltipContent>
  </TooltipPortal>
</template>
