<script setup lang="ts">
import { H5 } from '@/components/ui/typography'
import Caption from '@/components/ui/typography/Caption.vue'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface Props {
  title?: string
  description?: string
  frame?: boolean
  shadow?: boolean
  class?: string
}

const {
  shadow = true,
  frame = true,
  class: className = '',
} = defineProps<Props>()
</script>

<template>
  <div :class="cn('flex flex-col gap-2 w-full', className)">
    <div v-if="title || description" class="flex justify-between items-center">
      <div>
        <H5 v-if="title">{{ title }}</H5>
        <Caption v-if="description">{{ description }}</Caption>
      </div>
      <slot name="actions"></slot>
    </div>

    <Card v-if="frame" class="w-full h-full py-3 px-4 flex flex-col gap-4">
      <slot></slot>
    </Card>

    <div v-else class="w-full h-full flex flex-col gap-4">
      <slot></slot>
    </div>
  </div>
</template>
