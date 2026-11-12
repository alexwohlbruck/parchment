<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown } from 'lucide-vue-next'
import RouteBullet from '@/components/transit/bullets/RouteBullet.vue'
import { formatDurationCompact } from '@/lib/time-format'
import { approachReach } from '@/lib/transit/transit-reachability'
import { approachRace, arrivalZone, reachWord } from '@/lib/directions/trip-advice'
import { useNavigationPreferencesStore } from '@/stores/preferences/navigation-preferences.store'
import type { RunChoice } from '@/lib/guidance/run-choices'
import ApproachRace from './ApproachRace.vue'

const props = defineProps<{
  departureMs: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  segment: any
  nowMs: number
  toStopSec: number
  /** Walking to the stop, so running for it is an option. */
  onFoot: boolean
  /** The runs after this one, as the departure list has them. */
  later: RunChoice[]
  open?: boolean
}>()
defineEmits<{ toggle: [] }>()
const { t } = useI18n()

const navigationPreferences = useNavigationPreferencesStore()

const runFactor = computed(() => (props.onFoot ? navigationPreferences.runPace : null))
const race = computed(() => approachRace(props.departureMs, props.nowMs, props.toStopSec, runFactor.value))
const reach = computed(() => {
  const state = approachReach(props.departureMs, props.nowMs, props.toStopSec, runFactor.value)
  const comfortable = arrivalZone(race.value, props.nowMs) === 'calm' ? 'early' : 'ok'
  return reachWord(state, t) ?? { word: t(`guidance.transit.reach.${comfortable}`), tone: 'text-forest-600 dark:text-forest-400' }
})
const leadIn = (ms: number) => formatDurationCompact(Math.max(0, (ms - props.nowMs) / 1000))
const lead = computed(() => leadIn(props.departureMs))

/** "4m, 5 9m": the runs after this one, naming a different line where it is one. */
const laterText = computed(() =>
  props.later
    .map(({ candidate }) => {
      const otherLine = candidate.line && candidate.line !== props.segment?.lineName ? `${candidate.line} ` : ''
      return otherLine + leadIn(candidate.departureMs)
    })
    .join(', '),
)
</script>

<template>
  <div>
    <button
      class="flex w-full items-center gap-2 text-left text-sm"
      :aria-expanded="open"
      :aria-label="t('guidance.transit.otherRuns')"
      @click="$emit('toggle')"
    >
      <RouteBullet :label="segment?.lineName" :color="segment?.lineColor" :text-color="segment?.lineTextColor" />
      <span class="tabular-nums">
        {{ t('guidance.transit.inDuration', { duration: lead })
        }}<span v-if="laterText" class="text-muted-foreground">, {{ laterText }}</span>
      </span>
      <span class="ml-auto font-medium" :class="reach.tone">{{ reach.word }}</span>
      <ChevronDown class="size-4 shrink-0 text-muted-foreground transition-transform" :class="open && 'rotate-180'" />
    </button>
    <ApproachRace v-if="onFoot" class="mt-2.5" :race="race" :now-ms="nowMs" :line-name="segment?.lineName" />
  </div>
</template>
