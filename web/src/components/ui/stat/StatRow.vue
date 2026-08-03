<script setup lang="ts">
import type { Component } from 'vue'

/**
 * A run of metrics on one baseline — a headline figure followed by secondary
 * ones with leading icons. Used where a stat grid would be too heavy, e.g. the
 * summary line under a saved route's title.
 */
export interface StatRowItem {
  value: string
  /** Icon shown before a secondary value. The lead item usually has none. */
  icon?: Component
}

defineProps<{
  /** The headline figure, rendered larger. */
  lead?: string
  items: StatRowItem[]
}>()
</script>

<template>
  <div class="flex items-baseline gap-3 flex-wrap">
    <span v-if="lead" class="text-2xl font-semibold tabular-nums">{{ lead }}</span>
    <span
      v-for="(item, i) in items"
      :key="i"
      class="inline-flex items-center gap-1 text-sm text-muted-foreground tabular-nums"
    >
      <component v-if="item.icon" :is="item.icon" class="size-3.5" />
      {{ item.value }}
    </span>
  </div>
</template>
