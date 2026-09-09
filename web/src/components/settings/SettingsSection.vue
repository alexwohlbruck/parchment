<script setup lang="ts">
import { H5 } from '@/components/ui/typography'
import Caption from '@/components/ui/typography/Caption.vue'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface Props {
  id?: string
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
  <div
    :id="id"
    data-settings-section
    :data-section-id="id"
    :class="
      cn(
        'flex flex-col gap-3 w-full settings-section-target',
        !frame && 'flex-1 min-h-0',
        className,
      )
    "
  >
    <div
      v-if="title || description"
      class="sticky top-0 z-10 -mx-4 px-4 md:-ml-6 md:pl-6 pt-2 pb-1.5 flex justify-between items-center bg-background border-b"
    >
      <div>
        <H5 v-if="title" class="font-display">{{ title }}</H5>
        <Caption v-if="description">{{ description }}</Caption>
      </div>
      <slot name="actions"></slot>
    </div>

    <Card v-if="frame" class="w-full h-full py-3 px-4 flex flex-col gap-4">
      <slot></slot>
    </Card>

    <div v-else class="w-full flex-1 min-h-0 flex flex-col gap-4">
      <slot></slot>
    </div>
  </div>
</template>

<style scoped>
.settings-section-target {
  transition: box-shadow 0.5s ease-out;
}
.settings-section-target.is-flashing {
  box-shadow: 0 0 0 4px rgb(from var(--primary) r g b / 0.18);
  border-radius: var(--radius);
}
</style>
