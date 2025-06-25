<script setup lang="ts">
import type { CheckboxRootEmits, CheckboxRootProps } from 'reka-ui'
import { CheckboxIndicator, CheckboxRoot, useForwardPropsEmits } from 'reka-ui'
import { Check } from 'lucide-vue-next'
import { cn } from '@/lib/utils'

const props = defineProps<CheckboxRootProps>()
const emits = defineEmits<CheckboxRootEmits>()

const forwarded = useForwardPropsEmits(props, emits)
</script>

<template>
  <CheckboxRoot
    v-bind="forwarded"
    :class="
      cn(
        'peer size-4 shrink-0 rounded-sm border border-primary ring-offset-background transition-shadow focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
        $attrs.class ?? '',
      )
    "
  >
    <CheckboxIndicator
      class="flex h-full w-full items-center justify-center text-current"
    >
      <Check class="size-4" />
    </CheckboxIndicator>
  </CheckboxRoot>
</template>
