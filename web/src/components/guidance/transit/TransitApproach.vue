<script setup lang="ts">
import { computed, toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import RouteBullet from '@/components/transit/bullets/RouteBullet.vue'
import { formatDurationCompact } from '@/lib/time-format'
import { approachReach } from '@/lib/transit/transit-reachability'
import { reachWord } from '@/lib/directions/trip-advice'
import { useNavigationPreferencesStore } from '@/stores/preferences/navigation-preferences.store'
import { useLaterRuns } from '@/composables/guidance/useLaterRuns'

const props = defineProps<{
  departureMs: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  segment: any
  nowMs: number
  walkSec: number
}>()
const { t } = useI18n()

const navigationPreferences = useNavigationPreferencesStore()

const reach = computed(() => {
  const state = approachReach(props.departureMs, props.nowMs, props.walkSec, navigationPreferences.runPace)
  return reachWord(state, t) ?? { word: t('guidance.transit.reach.ok'), tone: 'text-forest-600 dark:text-forest-400' }
})
const leadIn = (ms: number) => formatDurationCompact(Math.max(0, (ms - props.nowMs) / 1000))
const lead = computed(() => leadIn(props.departureMs))

const later = useLaterRuns(toRef(props, 'segment'), toRef(props, 'departureMs'))
/** "4m, 5 9m": the runs after this one, naming a different line where it is one. */
const laterText = computed(() =>
  later.value
    .map(run => {
      const otherLine = run.lineName && run.lineName !== props.segment?.lineName ? `${run.lineName} ` : ''
      return otherLine + leadIn(run.departureMs)
    })
    .join(', '),
)
</script>

<template>
  <div class="flex items-center gap-2 text-sm">
    <RouteBullet :label="segment?.lineName" :color="segment?.lineColor" :text-color="segment?.lineTextColor" />
    <span class="tabular-nums">
      {{ t('guidance.transit.inDuration', { duration: lead })
      }}<span v-if="laterText" class="text-muted-foreground">, {{ laterText }}</span>
    </span>
    <span class="ml-auto font-medium" :class="reach.tone">{{ reach.word }}</span>
  </div>
</template>
