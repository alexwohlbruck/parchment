<script setup lang="ts">
import type { VariantProps } from 'class-variance-authority'
import { Primitive, type PrimitiveProps } from 'radix-vue'
import { buttonVariants } from '.'
import { cn } from '@/lib/utils'
import { PlusIcon, Loader2Icon } from 'lucide-vue-next'

interface ButtonVariantProps extends VariantProps<typeof buttonVariants> {}

interface Props extends PrimitiveProps {
  variant?: ButtonVariantProps['variant']
  size?: ButtonVariantProps['size']
  as?: string
  icon?: typeof PlusIcon
  description?: string
  loading?: boolean
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
    <Loader2Icon v-if="loading" class="w-4 h-4 mr-2 animate-spin" />

    <component
      v-if="icon && !loading"
      :is="icon"
      :class="{ 'mr-2': size !== 'icon', 'size-4': true }"
    ></component>

    <span v-if="description" class="sr-only">{{ description }}</span>
    <slot />
  </Primitive>
</template>
