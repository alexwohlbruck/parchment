<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { SearchIcon } from 'lucide-vue-next'
import {
  ComboboxInput,
  type ComboboxInputEmits,
  type ComboboxInputProps,
  useForwardPropsEmits,
} from 'reka-ui'
import { cn } from '@/lib/utils'

defineOptions({
  inheritAttrs: false,
})

const props = withDefaults(
  defineProps<
    ComboboxInputProps & {
      class?: HTMLAttributes['class']
      wrapperClass?: HTMLAttributes['class']
      hideSearchIcon?: boolean
    }
  >(),
  {
    hideSearchIcon: false,
  },
)

const emits = defineEmits<ComboboxInputEmits>()

const delegatedProps = reactiveOmit(props, 'class', 'wrapperClass', 'hideSearchIcon')

const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <div
    data-slot="command-input-wrapper"
    :class="cn(
      'focus-within:ring-ring flex h-10 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm ring-offset-background depth transition-shadow focus-within:ring-1 focus-within:ring-inset',
      props.wrapperClass,
    )"
  >
    <slot name="prefix">
      <SearchIcon v-if="!hideSearchIcon" class="size-4 shrink-0 opacity-50" />
    </slot>
    <ComboboxInput
      data-slot="command-input"
      :class="
        cn(
          'placeholder:text-muted-foreground w-full flex-1 bg-transparent outline-none disabled:cursor-not-allowed disabled:opacity-50',
          props.class,
        )
      "
      v-bind="{ ...forwarded, ...$attrs }"
    >
      <slot />
    </ComboboxInput>
    <slot name="postfix" />
  </div>
</template>
