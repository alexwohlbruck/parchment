<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import RouteBullet from '@/components/transit/bullets/RouteBullet.vue'
import { formatDurationCompact } from '@/lib/time-format'
import { departureReachability } from '@/lib/transit/transit-reachability'

const props = defineProps<{
  departureMs: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  segment: any
  nowMs: number
  walkSec: number
}>()
const { t } = useI18n()

const HURRY_MARGIN_SEC = 120
const REACH_STYLES = {
  ok: 'text-forest-600 dark:text-forest-400',
  hurry: 'text-amber-600 dark:text-amber-400',
  late: 'text-red-600 dark:text-red-400',
}

const reach = computed(() => {
  const state = departureReachability(props.departureMs, props.nowMs, props.walkSec, HURRY_MARGIN_SEC)
  return state === 'ok' || state === 'hurry' ? state : 'late'
})
const lead = computed(() => formatDurationCompact(Math.max(0, (props.departureMs - props.nowMs) / 1000)))
</script>

<template>
  <div class="flex items-center gap-2 text-sm">
    <RouteBullet :label="segment?.lineName" :color="segment?.lineColor" :text-color="segment?.lineTextColor" />
    <span class="tabular-nums">{{ t('guidance.transit.inDuration', { duration: lead }) }}</span>
    <span class="ml-auto font-medium" :class="REACH_STYLES[reach]">{{ t(`guidance.transit.reach.${reach}`) }}</span>
  </div>
</template>
