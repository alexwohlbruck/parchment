<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowRight, SignalLow, SignalZero } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import RouteBullet from '@/components/transit/bullets/RouteBullet.vue'
import { formatClock } from '@/lib/directions/trip-display'
import { formatDurationCompact } from '@/lib/time-format'
import { minutesUntil, type TransitStage } from '@/lib/guidance/transit-progress'
import type { RideCertainty } from '@/lib/guidance/ride-estimator'
import { afterRide } from '@/lib/guidance/after-ride'
import AfterRide from './AfterRide.vue'

const props = defineProps<{
  stage: TransitStage
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  segments: any[]
  nowMs: number
  certainty?: RideCertainty
  busy?: boolean
  noLaterRun?: boolean
  /** A recovery is being worked out or offered below, so the fallback actions stand back. */
  recovering?: boolean
}>()
defineEmits<{ nextRun: []; anotherWay: []; alight: [] }>()
const { t } = useI18n()

const segment = computed(() => props.segments[props.stage.segmentIndex])

const line = computed(() => segment.value?.lineName ?? '')
const toward = computed(() => segment.value?.directionLabel || segment.value?.headsign || segment.value?.lineLongName)

const countdown = computed(() => {
  const stage = props.stage
  if (stage.kind !== 'wait') return null
  const sec = (stage.departureMs - props.nowMs) / 1000
  return sec < 30 ? t('guidance.transit.departingNow') : t('guidance.transit.departsIn', { duration: formatDurationCompact(sec) })
})

const ride = computed(() => {
  const stage = props.stage
  if (stage.kind !== 'riding') return null
  const headline = stage.alighting
    ? t('guidance.transit.getOffNow')
    : stage.stopsLeft === 1
      ? t('guidance.transit.getOffNext')
      : t('guidance.transit.getOffAt', { stop: stage.alight })
  const stops = t('guidance.transit.stopsLeft', { n: stage.stopsLeft }, stage.stopsLeft)
  const minutes = minutesUntil(stage.arrivalMs, props.nowMs)
  return {
    headline,
    urgent: stage.stopsLeft === 1,
    detail: stage.alighting ? null : minutes != null ? `${stops} · ${formatDurationCompact(minutes * 60)}` : stops,
    next: stage.stopsLeft > 1 ? t('guidance.transit.nextStop', { stop: stage.nextStop }) : stage.alight,
    after: afterRide(props.segments, stage.segmentIndex),
  }
})
</script>

<template>
  <div class="flex flex-col gap-2.5">
    <div v-if="stage.kind === 'wait' || stage.kind === 'riding'" class="flex items-center gap-2 min-w-0">
      <RouteBullet
        size="md"
        class="shrink-0"
        :label="line"
        :color="segment?.lineColor"
        :text-color="segment?.lineTextColor"
      />
      <template v-if="toward">
        <ArrowRight class="size-3.5 shrink-0 text-muted-foreground" />
        <span class="truncate text-sm font-medium">{{ toward }}</span>
      </template>
    </div>

    <template v-if="stage.kind === 'wait'">
      <div class="font-display-heavy text-[28px] leading-none">{{ countdown }}</div>
      <div class="text-sm text-muted-foreground">
        {{ t('guidance.transit.from', { stop: stage.stop }) }} · {{ formatClock(new Date(stage.departureMs)) }}
      </div>
    </template>

    <template v-else-if="ride">
      <div
        class="font-display-heavy text-[28px] leading-none"
        :class="ride.urgent && 'text-primary'"
      >
        {{ ride.headline }}
      </div>
      <div class="flex justify-between gap-3 text-sm text-muted-foreground tabular-nums">
        <span class="truncate">{{ ride.next }}</span>
        <span class="flex shrink-0 items-center gap-1.5">
          <component
            :is="certainty === 'uncertain' ? SignalZero : SignalLow"
            v-if="ride.detail && certainty && certainty !== 'live'"
            class="size-3.5"
            role="img"
            :aria-label="t('guidance.transit.estimated')"
          />
          {{ ride.detail }}
        </span>
      </div>
      <AfterRide class="border-t pt-3" :after="ride.after" @alight="$emit('alight')" />
    </template>

    <template v-else-if="stage.kind === 'missed-vehicle'">
      <div>
        <div class="text-lg font-medium leading-snug">{{ t('guidance.transit.missedVehicle', { line }) }}</div>
        <div v-if="!recovering" class="text-sm text-muted-foreground">
          {{ noLaterRun ? t('guidance.transit.noLaterRun') : t('guidance.transit.missedVehicleHint') }}
        </div>
      </div>
      <div v-if="!recovering" class="flex gap-2">
        <Button class="h-12 flex-1 rounded-full" :disabled="busy || noLaterRun" @click="$emit('nextRun')">
          {{ t('guidance.transit.nextDeparture') }}
        </Button>
        <Button variant="secondary" class="h-12 flex-1 rounded-full" @click="$emit('anotherWay')">
          {{ t('guidance.transit.anotherWay') }}
        </Button>
      </div>
    </template>

    <template v-else-if="stage.kind === 'missed-stop'">
      <div>
        <div class="text-lg font-medium leading-snug">{{ t('guidance.transit.missedStop', { stop: stage.alight }) }}</div>
        <div class="text-sm text-muted-foreground">{{ t('guidance.transit.missedStopHint') }}</div>
      </div>
      <Button variant="secondary" class="h-12 rounded-full" @click="$emit('anotherWay')">
        {{ t('guidance.transit.anotherWay') }}
      </Button>
    </template>
  </div>
</template>
