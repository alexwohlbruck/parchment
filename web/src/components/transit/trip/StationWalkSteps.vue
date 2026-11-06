<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDownIcon, SignpostIcon } from 'lucide-vue-next'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { stationStepIcon } from '@/lib/transit/station/step-icons'
import { formatDurationShort } from '@/lib/time-format'
import type { StationWalk } from '@server/types/station-guidance.types'
import { stationSignText, type StationSign } from '@/lib/transit/station/station-signs'

const props = withDefaults(defineProps<{ walk: StationWalk; sign?: StationSign | null; timed?: boolean }>(), { timed: true })
const { t } = useI18n()

const steps = computed(() => (props.walk.estimate ? [] : props.walk.steps ?? []))
const time = computed(() => `${props.walk.estimate ? '≈ ' : ''}${formatDurationShort(props.walk.seconds)}`)

const signText = computed(() => (props.sign ? stationSignText(props.sign, t) : null))

function note(step: { levelChange: number | null; landmark: string | null; instruction: string }) {
  const landmark = step.landmark && !step.instruction.includes(step.landmark) ? step.landmark : null
  return [levels(step.levelChange), landmark].filter(Boolean).join(' · ')
}

function levels(change: number | null) {
  if (!change) return null
  const n = Math.abs(change)
  return change > 0 ? t('directions.station.levelUp', { n }, n) : t('directions.station.levelDown', { n }, n)
}
</script>

<template>
  <div v-if="!steps.length && signText" class="flex items-start gap-1.5 text-xs tabular-nums">
    <SignpostIcon class="mt-px size-3.5 shrink-0 text-muted-foreground" />
    <span class="text-foreground">{{ signText }}<span v-if="timed" class="text-muted-foreground"> · {{ time }}</span></span>
  </div>
  <div v-else-if="!steps.length" class="text-xs text-muted-foreground tabular-nums">
    {{ t('directions.station.insideStation') }} · {{ time }}
  </div>
  <Collapsible v-else v-slot="{ open }">
    <CollapsibleTrigger class="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer select-none">
      <ChevronDownIcon class="size-3.5 transition-transform" :class="open && 'rotate-180'" />
      <span class="tabular-nums">
        {{ t('directions.station.insideStation') }} · {{ t('directions.station.steps', { n: steps.length }, steps.length) }}<template v-if="timed"> · {{ time }}</template>
      </span>
    </CollapsibleTrigger>
    <CollapsibleContent>
      <ol class="mt-2 space-y-2">
        <li v-for="(step, i) in steps" :key="i" class="flex gap-2.5">
          <component :is="stationStepIcon(step)" class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <div class="min-w-0 flex-1">
            <div class="text-xs text-foreground leading-snug">{{ step.instruction }}</div>
            <div v-if="note(step)" class="text-[11px] text-muted-foreground">{{ note(step) }}</div>
          </div>
          <span v-if="step.duration >= 1" class="text-[11px] text-muted-foreground tabular-nums shrink-0">
            {{ formatDurationShort(step.duration) }}
          </span>
        </li>
      </ol>
    </CollapsibleContent>
  </Collapsible>
</template>
