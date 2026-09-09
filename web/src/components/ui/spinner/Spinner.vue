<script setup lang="ts">
import { Loader2Icon } from 'lucide-vue-next'
import { spinnerVariants } from '.'
import { VariantProps } from 'class-variance-authority'
import { PrimitiveProps } from 'reka-ui'
import { cn } from '@/lib/utils'

interface SpinnerVariantProps extends VariantProps<typeof spinnerVariants> {}

interface Props extends PrimitiveProps {
  size?: SpinnerVariantProps['size']
}

withDefaults(defineProps<Props>(), {
  size: 'default',
})
</script>

<template>
  <!-- Colour comes from the caller's own class. A `color` prop used to build
       `text-${color}` at runtime, which Tailwind's scanner can't see, so the
       class only ever existed if something else in the app happened to emit
       it. Nothing passed the prop. -->
  <Loader2Icon :class="cn(spinnerVariants({ size }), $attrs.class ?? '')" />
</template>
