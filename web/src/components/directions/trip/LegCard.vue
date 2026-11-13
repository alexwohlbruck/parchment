<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch, type HTMLAttributes } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDownIcon, SignpostIcon, TrendingUpIcon, TriangleAlertIcon } from 'lucide-vue-next'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import ManeuverIcon from '@/components/directions/ManeuverIcon.vue'
import LegCardSurface from './LegCardSurface.vue'
import { comfortableShare, legStretches, stretchAt, type Stretch } from '@/lib/directions/leg-stretches'
import { headsUpHazards, legHeadsUp } from '@/lib/directions/leg-heads-up'
import { maneuverKind } from '@/lib/directions/maneuver'
import { modeColor, movingDuration } from '@/lib/directions/trip-display'
import { getSegmentIcon } from '@/lib/directions/travel-mode-icons'
import { hazardCounts } from '@/lib/guidance/hazards'
import type { RouteProfileType } from '@/lib/directions/route-profile-colors'
import { formatDurationLong } from '@/lib/time-format'
import { useUnits } from '@/composables/useUnits'
import type { RouteInstruction } from '@/types/directions.types'

const props = defineProps<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  segment: any
  segmentIndex: number
  title: string
  railAbove?: { class?: HTMLAttributes['class']; style?: HTMLAttributes['style'] }
  /** Live: metres into this leg, when the traveller is on it. */
  progress?: number | null
  hoveredKey?: string | null
  detailedHazards?: boolean
  /** Replaces the closing "arrive" step when the walk ends at a stop, not the destination. */
  arrival?: { text: string; sign: boolean } | null
}>()

const emit = defineEmits<{
  hoverInstruction: [segmentIndex: number, instructionIndex: number, instruction: string | RouteInstruction]
  leaveInstruction: []
  routeProfileChange: [segmentIndex: number, profile: RouteProfileType | null]
}>()

const { t } = useI18n()
const { formatDistance, formatElevation } = useUnits()

const cycling = computed(() => props.segment.mode === 'cycling' || props.segment.mode === 'biking')
const instructions = computed<RouteInstruction[]>(() =>
  (props.segment.instructions ?? []).filter((i: unknown): i is RouteInstruction => typeof i === 'object'),
)
const stretches = computed(() => legStretches(props.segment))
/** A walk across a forecourt has nothing to unfold. */
const foldable = computed(() => (props.segment.distance ?? 0) >= 150 && (stretches.value.length > 1 || instructions.value.length > 2))

const open = ref(props.progress != null)
const turnsOpen = ref(false)
watch(() => props.progress != null, live => {
  if (live) open.value = true
})
watch(open, isOpen => {
  if (cycling.value && props.segment.edgeSegments?.length) emit('routeProfileChange', props.segmentIndex, isOpen ? 'stress' : null)
})
onBeforeUnmount(() => {
  if (open.value && cycling.value) emit('routeProfileChange', props.segmentIndex, null)
})

const rail = computed(() => modeColor(props.segment.mode))

const context = computed(() => {
  const parts: { text: string; climb?: boolean }[] = []
  const vehicle = props.segment.ownership === 'personal' && props.segment.mode !== 'walking' ? props.segment.vehicle?.name : null
  if (vehicle) parts.push({ text: vehicle })
  const share = cycling.value ? comfortableShare(props.segment) : null
  if (share != null) parts.push({ text: t('directions.leg.comfortable', { pct: Math.round(share * 100) }) })
  const gain = props.segment.mode === 'driving' ? 0 : props.segment.totalElevationGain ?? 0
  if (gain >= 10) parts.push({ text: formatElevation(gain), climb: true })
  return parts
})

const headsUp = computed(() => legHeadsUp(props.segment).slice(0, 2))
const COUNTED: Record<string, string[]> = {
  walking: ['crosswalk', 'traffic_signals'],
  cycling: ['traffic_signals', 'stop', 'crosswalk'],
  driving: ['traffic_signals'],
}
const counts = computed(() => {
  if (!props.detailedHazards) return []
  const counted = COUNTED[cycling.value ? 'cycling' : props.segment.mode] ?? []
  return hazardCounts(props.segment.hazards ?? [])
    .filter(({ kind }) => counted.includes(kind))
    .map(({ kind, count }) => t(`guidance.hazardCounts.${kind}`, count))
})

function stretchName(stretch: Stretch): string {
  return stretch.name ?? t(`directions.leg.unnamed.${stretch.surface}`)
}

function stretchTag(stretch: Stretch): string | null {
  const mode = props.segment.mode
  if (mode === 'driving' || !stretch.name) return null
  if (mode === 'walking') {
    if (stretch.surface === 'steps') return t('directions.leg.surface.steps')
    if (stretch.surface === 'path') return t('directions.leg.surface.sidewalk')
    return null
  }
  return stretch.surface === 'unknown' ? null : t(`directions.leg.surface.${stretch.surface}`)
}

const stretchWarnings = computed(() => {
  const hazards = headsUpHazards(props.segment)
  return stretches.value.map(s => {
    const kinds = new Set(hazards.filter(h => h.startDistance >= s.from && h.startDistance < s.to).map(h => h.kind))
    return [...kinds].map(kind => t(`guidance.hazards.${kind}`))
  })
})

const footerLabel = computed(() => {
  if (props.progress != null) return t('directions.leg.left', { distance: formatDistance(Math.max(0, (props.segment.distance ?? 0) - props.progress)) })
  if (open.value) return formatDistance(props.segment.distance ?? 0)
  const named = stretches.value.filter(s => s.name)
  const longest = [...named].sort((a, b) => b.to - b.from - (a.to - a.from)).slice(0, 2)
  const streets = named.filter(s => longest.includes(s)).map(s => s.name).join(', ')
  return streets ? t('directions.leg.via', { streets }) : formatDistance(props.segment.distance ?? 0)
})

const current = computed(() => (props.progress != null ? stretchAt(stretches.value, props.progress) : -1))
const currentShare = computed(() => {
  const s = stretches.value[current.value]
  return s && props.progress != null ? Math.min(1, (props.progress - s.from) / (s.to - s.from || 1)) : 0
})

const instructionKey = (index: number) => `${props.segmentIndex}-${index}`
const turnText = (instruction: RouteInstruction, index: number) =>
  props.arrival && index === instructions.value.length - 1 && maneuverKind(instruction) === 'arrive' ? props.arrival.text : instruction.text
</script>

<template>
  <Collapsible v-model:open="open" class="relative pb-3" :data-segment-leg="segmentIndex">
    <div class="absolute left-[22px] -translate-x-1/2 w-0.5 top-[-2px] h-[26px]" :class="railAbove?.class" :style="railAbove?.style" />
    <div class="absolute left-[22px] -translate-x-1/2 w-0.5 top-[24px] bottom-[-2px]" :class="rail" />
    <LegCardSurface />

    <div class="relative flex pl-2">
      <div class="flex w-7 shrink-0 justify-center">
        <div
          :data-node-segment="segmentIndex"
          data-node-at="start"
          class="relative z-10 mt-2.5 flex size-7 items-center justify-center rounded-full text-white ring-2 ring-muted-light"
          :class="rail"
        >
          <component :is="getSegmentIcon(segment.mode, segment.routeType)" class="size-3.5" />
        </div>
      </div>
      <div class="min-w-0 flex-1 pl-6 pr-3.5 pt-3">
        <div class="flex items-baseline justify-between gap-3">
          <span class="truncate text-sm font-semibold text-foreground">{{ title }}</span>
          <span class="shrink-0 text-[13px] tabular-nums text-muted-foreground">{{ formatDurationLong(movingDuration(segment)) }}</span>
        </div>
        <div v-if="context.length" class="mt-0.5 flex flex-wrap items-center text-xs text-muted-foreground">
          <template v-for="(part, i) in context" :key="i">
            <span v-if="i" class="mx-1.5 text-muted-foreground/60">·</span>
            <span class="inline-flex items-center gap-1 tabular-nums">
              <TrendingUpIcon v-if="part.climb" class="size-3" />{{ part.text }}
            </span>
          </template>
        </div>
        <slot />
        <div v-if="headsUp.length" class="mt-2.5 flex flex-wrap gap-1.5">
          <span
            v-for="item in headsUp"
            :key="item.kind"
            class="inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs"
            :class="item.severity === 'low' ? 'bg-muted text-muted-foreground' : 'bg-amber-500/12 text-amber-800 dark:text-amber-300'"
          >
            <TriangleAlertIcon class="size-3" />
            <span><template v-if="item.count > 1">{{ item.count }}× </template>{{ t(`guidance.hazards.${item.kind}`) }}</span>
            <span class="tabular-nums opacity-70">· {{ t('directions.leg.hazardAt', { distance: formatDistance(item.at) }) }}</span>
          </span>
        </div>
        <CollapsibleTrigger
          v-if="foldable"
          class="-mx-3.5 mt-3 flex h-11 w-[calc(100%+1.75rem)] cursor-pointer select-none items-center gap-2 border-t pl-3.5 pr-2.5 text-left text-[13px] transition-colors hover:bg-muted/40"
          :class="!open && 'rounded-b-2xl'"
        >
          <span class="min-w-0 flex-1 truncate font-medium text-foreground">{{ footerLabel }}</span>
          <span class="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <ChevronDownIcon class="size-3.5 transition-transform" :class="open && 'rotate-180'" />
          </span>
        </CollapsibleTrigger>
        <div v-else class="pb-3" />
      </div>
    </div>

    <CollapsibleContent v-if="foldable">
      <div
        v-for="(stretch, si) in stretches"
        :key="si"
        class="relative flex pl-2 transition-opacity"
        :class="si < current && 'opacity-40'"
        @mouseenter="emit('hoverInstruction', segmentIndex, stretch.instructions[0], instructions[stretch.instructions[0]])"
        @mouseleave="emit('leaveInstruction')"
      >
        <div class="flex w-7 shrink-0 justify-center">
          <div
            :data-node-segment="segmentIndex"
            :data-node-offset="stretch.from"
            class="relative z-10 mt-[15px] size-2.5 shrink-0 rounded-full ring-2 ring-muted-light"
            :class="!stretch.quality && rail"
            :style="stretch.quality ? { background: stretch.quality.color } : {}"
          />
        </div>
        <div class="min-w-0 flex-1 pl-6 pr-3.5">
          <div class="py-2" :class="si === current && '-mx-2 my-0.5 rounded-lg bg-muted/70 px-2'">
            <div class="flex items-baseline justify-between gap-3">
              <span class="truncate text-[13px] text-foreground" :class="si === current ? 'font-semibold' : 'font-medium'">{{ stretchName(stretch) }}</span>
              <span class="shrink-0 text-xs tabular-nums text-muted-foreground">{{ formatDistance(stretch.to - stretch.from) }}</span>
            </div>
            <div
              v-if="stretchTag(stretch) || stretch.climb || stretchWarnings[si].length"
              class="mt-px flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground"
            >
              <span v-if="stretchTag(stretch)" class="inline-flex items-center gap-1.5">
                <span
                  v-if="stretch.quality"
                  class="size-[7px] rounded-[2px]"
                  :style="{ background: stretch.quality.color }"
                />{{ stretchTag(stretch) }}
              </span>
              <span v-if="stretch.climb" class="inline-flex items-center gap-1 tabular-nums">
                <TrendingUpIcon class="size-3" />{{ t('directions.leg.climb', { pct: stretch.climb }) }}
              </span>
              <span v-for="warning in stretchWarnings[si]" :key="warning" class="inline-flex items-center gap-1 text-amber-800 dark:text-amber-300">
                <TriangleAlertIcon class="size-3" />{{ warning }}
              </span>
            </div>
            <div v-if="si === current" class="mt-1.5 h-[3px] overflow-hidden rounded-full bg-foreground/10">
              <div class="h-full rounded-full" :class="rail" :style="{ width: `${currentShare * 100}%` }" />
            </div>
          </div>
          <div
            v-for="(exit, ei) in stretch.exits.slice(0, 2)"
            :key="ei"
            class="flex items-center gap-1.5 pb-1.5 text-xs text-muted-foreground/80"
          >
            <ManeuverIcon :kind="maneuverKind(exit)" class="size-3.5 shrink-0" />
            <span class="truncate">{{ exit.text }}</span>
          </div>
        </div>
      </div>

      <div class="relative flex pl-2">
        <div class="w-7 shrink-0" />
        <div class="min-w-0 flex-1 pl-6 pr-3.5 pb-1">
          <button
            type="button"
            class="flex h-11 w-full cursor-pointer items-center text-[13px] font-medium text-primary"
            @click="turnsOpen = !turnsOpen"
          >
            {{ turnsOpen ? t('directions.leg.hideTurns') : t('directions.leg.allTurns', { n: instructions.length }) }}
          </button>
          <ol v-if="turnsOpen" class="pb-2">
            <li
              v-for="(instruction, index) in instructions"
              :key="index"
              class="-mx-2 flex items-start gap-2.5 rounded-md px-2 py-1.5 transition-colors"
              :class="hoveredKey === instructionKey(index) && 'bg-muted/60'"
              @mouseenter="emit('hoverInstruction', segmentIndex, index, instruction)"
              @mouseleave="emit('leaveInstruction')"
            >
              <SignpostIcon v-if="arrival?.sign && index === instructions.length - 1" class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <ManeuverIcon v-else :kind="maneuverKind(instruction)" class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <span class="min-w-0 flex-1 text-[13px] leading-snug text-foreground">{{ turnText(instruction, index) }}</span>
              <span v-if="instruction.distance" class="shrink-0 text-xs tabular-nums text-muted-foreground">{{ formatDistance(instruction.distance) }}</span>
            </li>
          </ol>
          <p v-if="counts.length" class="pb-2 text-xs text-muted-foreground">{{ counts.join(' · ') }}</p>
        </div>
      </div>
    </CollapsibleContent>
  </Collapsible>
</template>
