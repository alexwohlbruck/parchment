<script setup lang="ts">
import { H6 } from '@/components/ui/typography'
import Caption from '@/components/ui/typography/Caption.vue'
import Badge from '@/components/ui/badge/Badge.vue'
import type { Component } from 'vue'

interface Props {
  title: string
  description?: string
  block?: boolean
  icon?: Component
  badge?: string
  badgeVariant?: 'default' | 'primary' | 'secondary' | 'destructive' | 'outline'
}

defineProps<Props>()
</script>

<template>
  <div class="flex justify-between gap-2 items-center">
    <div class="flex items-center gap-3">
      <component v-if="icon" :is="icon" class="size-5" />
      <div :class="{ 'self-start mt-2.5': block }">
        <div class="flex items-center gap-2">
          <H6>{{ title }}</H6>
          <Badge
            v-if="badge"
            :variant="badgeVariant || 'primary'"
            class="text-[10px] px-1.5 py-0"
          >
            {{ badge }}
          </Badge>
        </div>
        <Caption v-if="description">
          {{ description }}
        </Caption>
      </div>
    </div>
    <slot></slot>
  </div>
</template>
