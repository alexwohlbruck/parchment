<script setup lang="ts">
import type { Badge } from '@/lib/directions/trip-advice'

defineProps<{ badges: Badge[] }>()
</script>

<template>
  <div v-if="badges.length" class="flex min-w-0 flex-wrap items-center gap-1 tabular-nums">
    <span
      v-for="badge in badges"
      :key="badge.text"
      class="shrink-0 whitespace-nowrap rounded px-1.5 py-px font-medium"
      :class="badge.tone"
    >
      {{ badge.text }}
    </span>
  </div>
</template>
