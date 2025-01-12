<script setup lang="ts">
import type { VariantProps } from 'class-variance-authority'
import { Primitive, type PrimitiveProps } from 'radix-vue'
import { buttonVariants } from '.'
import { cn } from '@/lib/utils'
import { PlusIcon } from 'lucide-vue-next'
import { Spinner } from '@/components/ui/spinner'

interface ButtonVariantProps extends VariantProps<typeof buttonVariants> {}

interface Props extends PrimitiveProps {
  variant?: ButtonVariantProps['variant']
  size?: ButtonVariantProps['size']
  as?: string
  icon?: typeof PlusIcon
  description?: string
  loading?: boolean
  disabled?: boolean
}

withDefaults(defineProps<Props>(), {
  variant: 'default',
  size: 'default',
  as: 'button',
  disabled: false,
})
</script>

<template>
  <Primitive
    :as="as"
    :as-child="asChild"
    :class="
      cn(buttonVariants({ variant, size }), $attrs.class ?? '', {
        'opacity-50 pointer-events-none': disabled,
      })
    "
    :disabled="disabled"
  >
    <Spinner size="icon" v-if="loading" :class="{ 'mr-2': size !== 'icon' }" />

    <component
      v-if="icon && !loading"
      :is="icon"
      :class="{ 'mr-2': size !== 'icon', 'size-4': true }"
    ></component>

    <span v-if="description" class="sr-only">{{ description }}</span>
    <slot />
  </Primitive>
</template>
