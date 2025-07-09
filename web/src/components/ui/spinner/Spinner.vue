<script setup lang="ts">
import { Loader2Icon } from 'lucide-vue-next'
import { spinnerVariants } from '.'
import { VariantProps } from 'class-variance-authority'
import { PrimitiveProps } from 'reka-ui'
import { cn } from '@/lib/utils'

interface SpinnerVariantProps extends VariantProps<typeof spinnerVariants> {}

interface Props extends PrimitiveProps {
  size?: SpinnerVariantProps['size']
  color?: string
}

withDefaults(defineProps<Props>(), {
  size: 'default',
  color: 'current',
})
</script>

<template>
  <Loader2Icon
    :class="cn(spinnerVariants({ size }), `text-${color}`, $attrs.class ?? '')"
  />
</template>
