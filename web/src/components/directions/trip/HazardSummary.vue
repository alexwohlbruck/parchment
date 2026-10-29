<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { TriangleAlertIcon } from 'lucide-vue-next'
import { hazardCounts, isAlertable } from '@/lib/guidance/hazards'
import type { RouteHazard } from '@/types/directions.types'

const props = defineProps<{ hazards: RouteHazard[]; detailed: boolean }>()
const { t } = useI18n()

/** Counted kinds read as "12 lights"; the rest by name. Counts are the premium view. */
const COUNTED = new Set(['crosswalk', 'traffic_signals', 'stop'])

const items = computed(() => {
  const counts = hazardCounts(props.hazards)
  if (props.detailed) {
    return counts.map(({ kind, count }) =>
      COUNTED.has(kind) ? t(`guidance.hazardCounts.${kind}`, count) : t(`guidance.hazards.${kind}`),
    )
  }
  return counts.filter(({ kind }) => props.hazards.some(h => h.kind === kind && isAlertable(h))).map(({ kind }) => t(`guidance.hazards.${kind}`))
})
</script>

<template>
  <div v-if="items.length" class="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
    <TriangleAlertIcon class="mt-px size-3.5 shrink-0 text-amber-500" />
    <span>{{ items.join(' · ') }}</span>
  </div>
</template>
