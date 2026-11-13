<script setup lang="ts">
import { computed } from 'vue'
import type { RouteProfileType } from '@/lib/directions/route-profile-colors'
import { profileStats, profileSummary } from '@/lib/directions/route-profile-stats'
import { canColorBy, type StripSegment } from '@/lib/directions/trip-strip'

const props = defineProps<{ segments: StripSegment[]; colorBy: RouteProfileType | null }>()

const stats = computed(() => {
  const profile = props.colorBy
  if (!profile) return []
  return profileStats(props.segments.filter(s => canColorBy(s, profile)).flatMap(s => s.edgeSegments ?? []), profile)
})
const summary = computed(() => (props.colorBy ? profileSummary(stats.value, props.colorBy) : ''))
</script>

<template>
  <div v-if="summary || stats.length">
    <p v-if="summary" class="text-sm font-medium leading-tight text-foreground">{{ summary }}</p>
    <div v-if="stats.length" class="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
      <div v-for="stat in stats" :key="stat.key" class="flex items-center gap-1.5">
        <span class="size-1.5 shrink-0 rounded-full" :style="{ backgroundColor: stat.color }" />
        <span class="text-[11px] leading-none text-muted-foreground">{{ stat.percentage }}% {{ stat.label.toLowerCase() }}</span>
      </div>
    </div>
  </div>
</template>
