<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ManeuverIcon from '@/components/directions/ManeuverIcon.vue'
import { maneuverKind } from '@/lib/directions/maneuver'
import { bannerDistance } from '@/lib/guidance/guidance-display'
import type { LanePlan } from '@/lib/guidance/lanes'
import LaneStrip from './LaneStrip.vue'
import type { GuidanceProgress, GuidanceStatus } from '@/stores/guidance.store'

const props = defineProps<{
  progress: GuidanceProgress | null
  status: GuidanceStatus
  destination: string | null
  metric: boolean
  lanes?: LanePlan | null
}>()
const { t } = useI18n()

const next = computed(() => props.progress?.next ?? null)
const kind = computed(() => (next.value ? maneuverKind(next.value.instruction) : 'straight'))
const distance = computed(() => bannerDistance(props.progress?.distanceToNext ?? 0, props.metric))
const road = computed(() => {
  const instruction = next.value?.instruction
  if (!instruction) return ''
  if (kind.value === 'arrive') return t('guidance.banner.arrive')
  return instruction.streetName || instruction.streetRef || instruction.text
})
const then = computed(() => (props.progress?.then ? maneuverKind(props.progress.then.instruction) : null))
const offRoute = computed(() => props.progress && !props.progress.puck.snapped)
const headline = computed(() => {
  if (props.status === 'arrived') return t('guidance.banner.arrived')
  if (props.status === 'rerouting') return t('guidance.banner.rerouting')
  return offRoute.value ? t('guidance.banner.offRoute') : null
})
</script>

<template>
  <div class="pointer-events-auto overflow-hidden rounded-2xl bg-zinc-900/95 text-white shadow-lg backdrop-blur">
    <div v-if="!progress" class="px-4 py-3.5 text-base text-white/80">
      {{ t('guidance.waitingForLocation') }}
    </div>
    <div v-else-if="headline" class="px-4 py-3.5">
      <div class="text-lg font-semibold">{{ headline }}</div>
      <div v-if="status === 'arrived' && destination" class="truncate text-sm text-white/70">{{ destination }}</div>
      <div v-else-if="status !== 'arrived'" class="text-sm text-white/70">{{ t('guidance.banner.offRouteHint') }}</div>
    </div>
    <div v-else-if="next" class="flex items-center gap-3.5 px-4 py-3">
      <ManeuverIcon :kind="kind" :exit="next.instruction.exitNumber" class="size-11 shrink-0" />
      <div class="min-w-0">
        <div class="flex items-baseline gap-1 tabular-nums leading-none">
          <span class="font-display text-[34px]">{{ distance.value }}</span>
          <span class="text-lg text-white/75">{{ t(`guidance.units.${distance.unit}`) }}</span>
        </div>
        <div class="mt-1 truncate text-lg font-medium leading-tight">{{ road }}</div>
      </div>
    </div>
    <LaneStrip v-if="lanes && next && !headline" :plan="lanes" />
    <div v-if="then && !headline" class="flex items-center gap-2 bg-white/10 px-4 py-1.5 text-sm">
      <span class="text-white/75">{{ t('guidance.banner.then') }}</span>
      <ManeuverIcon :kind="then" class="size-5" />
    </div>
  </div>
</template>
