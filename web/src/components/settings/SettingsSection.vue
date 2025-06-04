<script setup lang="ts">
import { H5 } from '@/components/ui/typography'
import Caption from '@/components/ui/typography/Caption.vue'
import { Card } from '@/components/ui/card'

interface Props {
  title?: string
  description?: string
  frame?: boolean
  shadow?: boolean
}

const { shadow, frame } = withDefaults(defineProps<Props>(), {
  frame: true,
  shadow: true,
})
</script>

<template>
  <div class="flex flex-col gap-2 w-full">
    <div v-if="title || description" class="flex justify-between items-center">
      <div>
        <H5 v-if="title">{{ title }}</H5>
        <Caption v-if="description">{{ description }}</Caption>
      </div>
      <slot name="actions"></slot>
    </div>

    <Card v-if="frame" class="w-full py-3 px-4 flex flex-col gap-4">
      <slot></slot>
    </Card>

    <div
      v-else
      class="w-full flex flex-col gap-4"
      :class="{ 'shadow-sm': shadow, 'py-3': !frame && !shadow }"
    >
      <slot></slot>
    </div>
  </div>
</template>
