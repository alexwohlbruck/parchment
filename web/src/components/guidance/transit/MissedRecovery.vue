<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Loader2 } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import RouteBullet from '@/components/transit/bullets/RouteBullet.vue'
import { formatClock } from '@/lib/directions/trip-display'
import { formatDurationCompact, formatDurationLong } from '@/lib/time-format'
import type { RecoveryView } from '@/composables/guidance/useMissedRecovery'
import type { RecoveryPlan } from '@/lib/guidance/missed-recovery'
import type { TripOption } from '@/types/directions.types'

type Plan = RecoveryPlan<TripOption>

const props = defineProps<{ view: RecoveryView; nowMs: number }>()
defineEmits<{ take: [plan: Plan]; otherRoutes: [] }>()
const { t } = useI18n()

const clock = (ms: number) => formatClock(new Date(ms))
const rides = (plan: Plan) => plan.itinerary.segments.filter(s => s.mode === 'transit')
const boarding = (plan: Plan) => rides(plan)[0]?.departureStop?.name ?? ''
const lines = (plan: Plan) => rides(plan).map(s => s.lineName ?? '').join(' → ')

function arrival(arrivalMs: number, delayMs: number) {
  const at = t('guidance.recovery.arrive', { time: clock(arrivalMs) })
  return delayMs >= 60_000 ? `${at} (${t('guidance.recovery.later', { duration: formatDurationLong(delayMs / 1000) })})` : at
}

const leadIn = (ms: number) => formatDurationCompact(Math.max(0, (ms - props.nowMs) / 1000))
</script>

<template>
  <div class="flex flex-col gap-3">
    <div v-if="view.kind === 'pending'" class="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 class="size-4 animate-spin" />
      {{ t('guidance.recovery.finding') }}
    </div>

    <template v-else-if="view.kind === 'retimed'">
      <template v-if="view.better">
        <div class="flex items-center gap-3">
          <div class="min-w-0 flex-1">
            <div class="font-medium leading-snug">
              {{ t('guidance.recovery.take', { lines: lines(view.better), stop: boarding(view.better) }) }}
            </div>
            <div class="text-sm text-muted-foreground tabular-nums">
              {{ t('guidance.recovery.arrive', { time: clock(view.better.arrivalMs) }) }}
            </div>
          </div>
          <Button class="h-10 shrink-0 rounded-full px-5" @click="$emit('take', view.better)">
            {{ t('guidance.recovery.switch') }}
          </Button>
        </div>
        <div class="text-sm text-muted-foreground tabular-nums">
          {{ t('guidance.recovery.orWait', { line: view.line, time: clock(view.arrivalMs) }) }}
        </div>
      </template>
      <div v-else class="text-sm tabular-nums">
        {{ t('guidance.recovery.next', { line: view.line, duration: leadIn(view.departureMs) }) }}
        · {{ arrival(view.arrivalMs, view.delayMs) }}
      </div>
    </template>

    <div v-else class="flex flex-col gap-1">
      <button
        v-for="(plan, i) in view.options"
        :key="plan.itinerary.id"
        class="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors"
        :class="i === 0 ? 'bg-primary/10 hover:bg-primary/15' : 'hover:bg-muted'"
        @click="$emit('take', plan)"
      >
        <span class="flex shrink-0 items-center gap-1">
          <RouteBullet
            v-for="(ride, r) in rides(plan)"
            :key="r"
            :label="ride.lineName"
            :color="ride.lineColor"
            :text-color="ride.lineTextColor"
          />
        </span>
        <span class="min-w-0 flex-1 truncate text-sm text-muted-foreground tabular-nums">
          {{ t('guidance.recovery.fromAt', { stop: boarding(plan), time: clock(plan.departureMs) }) }}
        </span>
        <span class="shrink-0 text-sm font-medium tabular-nums">
          {{ t('guidance.recovery.arrive', { time: clock(plan.arrivalMs) }) }}
        </span>
      </button>
    </div>

    <button
      v-if="view.kind !== 'pending'"
      class="self-start text-sm font-medium text-primary"
      @click="$emit('otherRoutes')"
    >
      {{ t('guidance.recovery.otherRoutes') }}
    </button>
  </div>
</template>
