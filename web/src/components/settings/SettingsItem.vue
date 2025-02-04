<script setup lang="ts">
import { H6 } from '@/components/ui/typography'
import Caption from '@/components/ui/typography/Caption.vue'
// import { Component } from 'vue'

interface Props {
  title: string
  description?: string
  block?: boolean
  icon?: any // TODO: Fix this
}

defineProps<Props>()
</script>

<template>
  <div class="flex justify-between gap-2 items-center">
    <div class="flex items-center gap-3">
      <component v-if="icon" :is="icon" class="size-5" />
      <div :class="{ 'self-start mt-2.5': block }">
        <H6>{{ title }}</H6>
        <Caption v-if="description">
          {{ description }}
        </Caption>
      </div>
    </div>
    <slot></slot>
  </div>
</template>
