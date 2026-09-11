<script setup lang="ts">
import { computed } from 'vue'
import { ChevronRightIcon } from 'lucide-vue-next'
import {
  getTravelModeColor,
  getTravelModeCssClass,
} from '@/lib/directions/travel-mode-colors'
import { getModeIcon, getSegmentIcon } from '@/lib/directions/travel-mode-icons'
import { tripChips, type TripChip } from '@/lib/directions/trip-chips'
import type { TripOption } from '@/types/directions.types'

const props = defineProps<{ segments: TripOption['segments'] }>()

const chips = computed(() => tripChips(props.segments))

function badgeStyle(chip: Extract<TripChip, { kind: 'transit' }>) {
  if (!chip.color) return {}
  return { background: `#${chip.color}`, color: `#${chip.textColor ?? 'fff'}` }
}
</script>

<template>
  <div class="flex items-center gap-1 flex-wrap">
    <template v-for="(chip, i) in chips" :key="i">
      <ChevronRightIcon
        v-if="i > 0"
        class="size-3 shrink-0 text-muted-foreground/40"
      />

      <span v-if="chip.kind === 'transit'" class="inline-flex items-center gap-1">
        <component
          :is="getSegmentIcon('transit', chip.routeType)"
          class="size-3.5 text-muted-foreground"
        />
        <span
          v-if="chip.label"
          class="rounded px-1.5 py-px text-[11px] font-bold leading-[1.35] text-white"
          :class="!chip.color && getTravelModeCssClass('transit')"
          :style="badgeStyle(chip)"
        >
          {{ chip.label }}
        </span>
      </span>

      <span
        v-else
        class="inline-flex items-center gap-1 text-[11px] font-medium tabular-nums text-muted-foreground"
      >
        <component
          :is="getModeIcon(chip.kind === 'walk' ? 'walking' : chip.mode)"
          class="size-3.5"
          :style="{
            color: getTravelModeColor(chip.kind === 'walk' ? 'walking' : chip.mode),
          }"
        />
        {{ chip.minutes }}<span class="text-[10px] font-normal">min</span>
      </span>
    </template>
  </div>
</template>
