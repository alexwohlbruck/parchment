<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowRight } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import RouteBullet from '@/components/transit/bullets/RouteBullet.vue'
import { formatClock } from '@/lib/directions/trip-display'
import { formatDurationCompact } from '@/lib/time-format'
import { ALIGHT_NOW_METERS, type TransitStage } from '@/lib/guidance/transit-progress'

const props = defineProps<{
  stage: TransitStage
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  segment: any
  nowMs: number
  busy?: boolean
  noLaterRun?: boolean
}>()
defineEmits<{ nextRun: []; anotherWay: [] }>()
const { t } = useI18n()

const line = computed(() => props.segment?.lineName ?? '')
const toward = computed(() => props.segment?.headsign || props.segment?.lineLongName)

const countdown = computed(() => {
  const stage = props.stage
  if (stage.kind !== 'wait') return null
  const sec = (stage.departureMs - props.nowMs) / 1000
  return sec < 30 ? t('guidance.transit.departingNow') : t('guidance.transit.departsIn', { duration: formatDurationCompact(sec) })
})

const ride = computed(() => {
  const stage = props.stage
  if (stage.kind !== 'riding') return null
  const sec = stage.arrivalMs != null ? Math.max(0, (stage.arrivalMs - props.nowMs) / 1000) : null
  const headline =
    stage.remaining < ALIGHT_NOW_METERS
      ? t('guidance.transit.getOffNow')
      : stage.stopsLeft === 1
        ? t('guidance.transit.getOffNext')
        : t('guidance.transit.getOffAt', { stop: stage.alight })
  const stops = t('guidance.transit.stopsLeft', { n: stage.stopsLeft }, stage.stopsLeft)
  return {
    headline,
    urgent: stage.stopsLeft === 1,
    detail: sec != null ? `${stops} · ${formatDurationCompact(sec)}` : stops,
    next: stage.stopsLeft > 1 ? t('guidance.transit.nextStop', { stop: stage.nextStop }) : stage.alight,
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
        <span class="shrink-0">{{ ride.detail }}</span>
      </div>
    </template>

    <template v-else-if="stage.kind === 'missed-vehicle'">
      <div>
        <div class="text-lg font-medium leading-snug">{{ t('guidance.transit.missedVehicle', { line }) }}</div>
        <div class="text-sm text-muted-foreground">
          {{ noLaterRun ? t('guidance.transit.noLaterRun') : t('guidance.transit.missedVehicleHint') }}
        </div>
      </div>
      <div class="flex gap-2">
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
