<script setup lang="ts">
import { computed, ref } from 'vue'
import dayjs from 'dayjs'
import { useI18n } from 'vue-i18n'
import { ChevronDownIcon, CheckIcon } from 'lucide-vue-next'
import { getSegmentIcon } from '@/lib/directions/travel-mode-icons'
import { formatDurationParts } from '@/lib/time-format'
import type { TripLegOptions, TripOption } from '@/types/directions.types'

interface Props {
  leg: TripLegOptions
  /** Name of the stop this leg ends at. */
  destination: string
  busy?: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{ select: [optionId: string] }>()

const { t } = useI18n()
const open = ref(false)

const chosen = computed(() => props.leg.options[0])

/** One icon per mode change, so a leg reads walk › train › walk. */
function modeRun(option: TripOption) {
  const runs: { mode: string; routeType?: string }[] = []
  for (const segment of option.segments) {
    const previous = runs[runs.length - 1]
    if (previous?.mode !== segment.mode) {
      runs.push({ mode: segment.mode, routeType: (segment as any).routeType })
    }
  }
  return runs
}

function duration(option: TripOption) {
  return formatDurationParts(option.summary.totalDuration)
    .parts.map(p => `${p.value}${p.unit === 'min' ? ' min' : p.unit}`)
    .join(' ')
}

function choose(option: TripOption) {
  open.value = false
  if (option.id !== chosen.value?.id) emit('select', option.id)
}
</script>

<template>
  <div v-if="leg.options.length > 1" class="-mx-2 mt-1">
    <button
      type="button"
      class="flex items-center gap-1.5 w-full rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted/60 disabled:opacity-50"
      :disabled="busy"
      @click="open = !open"
    >
      <span>{{ t('directions.legOptions.waysTo', { count: leg.options.length, stop: destination }) }}</span>
      <ChevronDownIcon class="size-3 transition-transform" :class="open && 'rotate-180'" />
      <span v-if="leg.carriedMode" class="ml-auto">
        {{ t(`directions.legOptions.carried.${leg.carriedMode}`) }}
      </span>
    </button>

    <div v-if="open" class="mt-1 space-y-0.5">
      <button
        v-for="option in leg.options"
        :key="option.id"
        type="button"
        class="flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-left hover:bg-muted/60 disabled:opacity-50"
        :disabled="busy"
        @click="choose(option)"
      >
        <div class="flex items-center gap-1 shrink-0">
          <component
            :is="getSegmentIcon(run.mode, run.routeType)"
            v-for="(run, i) in modeRun(option)"
            :key="i"
            class="size-3.5 text-foreground/70"
          />
        </div>
        <span class="text-xs font-medium">{{ duration(option) }}</span>
        <span class="text-xs text-muted-foreground tabular-nums">
          {{ dayjs(option.startTime).format('h:mm') }}–{{ dayjs(option.endTime).format('h:mm a') }}
        </span>
        <CheckIcon v-if="option.id === chosen?.id" class="ml-auto size-3.5 shrink-0" />
      </button>
    </div>
  </div>
</template>
