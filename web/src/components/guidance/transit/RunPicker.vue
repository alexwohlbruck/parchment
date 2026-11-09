<script setup lang="ts">
import { computed, toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check } from 'lucide-vue-next'
import RouteBullet from '@/components/transit/bullets/RouteBullet.vue'
import { formatClock } from '@/lib/directions/trip-display'
import { formatDurationCompact } from '@/lib/time-format'
import { reachWord } from '@/lib/directions/trip-advice'
import type { VehicleCandidate } from '@/lib/guidance/vehicle-switch'
import { useRunChoices } from '@/composables/guidance/useRunChoices'

const props = defineProps<{ segmentIndex: number; walkSec: number; nowMs: number }>()
const emit = defineEmits<{ choose: [candidate: VehicleCandidate, known: string[]] }>()
const { t } = useI18n()

const { choices, known, loading } = useRunChoices(toRef(props, 'segmentIndex'), toRef(props, 'walkSec'))

const rows = computed(() => choices.value.map(choice => ({ ...choice, hint: reachWord(choice.reach, t) })))
const lead = (ms: number) => formatDurationCompact(Math.max(0, (ms - props.nowMs) / 1000))

function pick(candidate: VehicleCandidate, booked: boolean) {
  if (!booked) emit('choose', candidate, known.value)
}
</script>

<template>
  <div class="flex flex-col">
    <button
      v-for="{ candidate, hint, arrivalMs, booked } in rows"
      :key="candidate.tripId"
      class="-mx-2 flex h-14 items-center gap-3 rounded-xl px-2 text-left transition-colors hover:bg-accent active:bg-accent"
      :aria-current="booked || undefined"
      @click="pick(candidate, booked)"
    >
      <RouteBullet size="md" class="shrink-0" :label="candidate.line" :color="candidate.color" :text-color="candidate.textColor" />
      <div class="min-w-0 flex-1">
        <div class="text-sm font-medium tabular-nums">{{ lead(candidate.departureMs) }}</div>
        <div class="truncate text-xs text-muted-foreground tabular-nums">
          {{ formatClock(new Date(candidate.departureMs)) }}
          <template v-if="arrivalMs"> · {{ t('guidance.transit.arrivesAt', { time: formatClock(new Date(arrivalMs)) }) }}</template>
        </div>
      </div>
      <span v-if="hint" class="shrink-0 text-sm font-medium" :class="hint.tone">{{ hint.word }}</span>
      <Check v-if="booked" class="size-4 shrink-0 text-primary" />
    </button>
    <div v-if="!rows.length" class="py-3 text-sm text-muted-foreground">
      {{ loading ? t('guidance.transit.loadingRuns') : t('guidance.transit.noOtherRuns') }}
    </div>
  </div>
</template>
