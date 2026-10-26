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
  /** The larger, arm's-length sizing of the wide layout. */
  dash?: boolean
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
const subline = computed(() => (props.status === 'arrived' ? props.destination : t('guidance.banner.offRouteHint')))
</script>

<template>
  <div>
    <div v-if="!progress" class="px-5 py-5 text-lg text-muted-foreground">
      {{ t('guidance.waitingForLocation') }}
    </div>
    <div v-else-if="headline" class="px-5 py-4">
      <div class="font-display leading-tight" :class="dash ? 'text-[32px]' : 'text-[28px]'">{{ headline }}</div>
      <div v-if="subline" class="mt-0.5 truncate text-muted-foreground" :class="dash ? 'text-lg' : 'text-base'">{{ subline }}</div>
    </div>
    <div v-else-if="next" class="flex items-center" :class="dash ? 'gap-5 px-5 py-5' : 'gap-4 px-4 py-4'">
      <ManeuverIcon :kind="kind" :exit="next.instruction.exitNumber" class="shrink-0" :class="dash ? 'size-16' : 'size-12'" />
      <div class="min-w-0 flex-1">
        <div class="flex items-baseline gap-1 tabular-nums leading-none">
          <span class="font-display" :class="dash ? 'text-[52px]' : 'text-[42px]'">{{ distance.value }}</span>
          <span class="text-muted-foreground" :class="dash ? 'text-2xl' : 'text-xl'">{{ t(`guidance.units.${distance.unit}`) }}</span>
        </div>
        <div class="mt-1.5 line-clamp-2 font-semibold leading-tight" :class="dash ? 'text-[26px]' : 'text-[22px]'">{{ road }}</div>
      </div>
    </div>
    <LaneStrip v-if="lanes && next && !headline" :plan="lanes" :kind="kind" :dash="dash" />
    <div
      v-if="then && !headline"
      class="flex items-center gap-2 border-t px-5 text-muted-foreground"
      :class="dash ? 'py-2.5 text-lg' : 'py-2 text-base'"
    >
      <span>{{ t('guidance.banner.then') }}</span>
      <ManeuverIcon :kind="then" class="text-foreground" :class="dash ? 'size-7' : 'size-6'" />
    </div>
  </div>
</template>
