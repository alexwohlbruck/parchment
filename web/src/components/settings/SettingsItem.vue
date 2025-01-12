<script setup lang="ts">
import { H6 } from '@/components/ui/typography'
import Caption from '@/components/ui/typography/Caption.vue'

interface Props {
  title: string
  description?: string
  block?: boolean
}

defineProps<Props>()
</script>

<template>
  <div class="flex justify-between gap-2 items-center">
    <div :class="{ 'self-start mt-2.5': block }">
      <H6>{{ title }}</H6>
      <Caption v-if="description">
        {{ description }}
      </Caption>
    </div>
    <slot></slot>
  </div>
</template>
