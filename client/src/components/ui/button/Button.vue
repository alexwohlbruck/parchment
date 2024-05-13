<script setup lang="ts">
import type { VariantProps } from 'class-variance-authority'
import { Primitive, type PrimitiveProps } from 'radix-vue'
import { buttonVariants } from '.'
import { cn } from '@/lib/utils'
import { PlusIcon } from 'lucide-vue-next'

interface ButtonVariantProps extends VariantProps<typeof buttonVariants> {}

interface Props extends PrimitiveProps {
  variant?: ButtonVariantProps['variant']
  size?: ButtonVariantProps['size']
  as?: string
  icon?: typeof PlusIcon
}

withDefaults(defineProps<Props>(), {
  variant: 'default',
  size: 'default',
  as: 'button',
})
</script>

<template>
  <Primitive
    :as="as"
    :as-child="asChild"
    :class="cn(buttonVariants({ variant, size }), $attrs.class ?? '')"
  >
    <component v-if="icon" :is="icon" class="size-4 mr-2"></component>
    <slot />
  </Primitive>
</template>
