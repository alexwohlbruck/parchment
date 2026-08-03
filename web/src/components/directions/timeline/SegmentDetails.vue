<script setup lang="ts">
import {
  ChevronDownIcon,
  ArrowUp,
  ArrowLeft,
  ArrowRight,
  ArrowUpLeft,
  ArrowUpRight,
  FlagIcon,
  Undo2Icon,
} from 'lucide-vue-next'
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible'
import ElevationChart from '@/components/directions/ElevationChart.vue'
import { useUnits } from '@/composables/useUnits'
import { StatTile } from '@/components/ui/stat'
import { formatDurationCompact } from '@/lib/time.utils'
import type { RouteInstruction } from '@/types/directions.types'

/**
 * The optional depth behind a trip leg — distance/ascent/descent, the
 * elevation profile, and turn-by-turn steps. Folded by default so a whole
 * trip still fits on one screen.
 */
const props = defineProps<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  segment: any
  segmentIndex: number
  /** Key of the step currently highlighted on the map, if any. */
  hoveredKey: string | null
}>()

const emit = defineEmits<{
  hoverInstruction: [
    segmentIndex: number,
    instructionIndex: number,
    instruction: string | RouteInstruction,
  ]
  leaveInstruction: []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  'update:routeProfile': [...args: any[]]
}>()

const { formatDistance, formatElevation } = useUnits()

const formatDistanceDisplay = (meters: number | undefined): string =>
  meters == null ? '' : formatDistance(meters)

/** A profile is only meaningful for self-powered modes that record elevation. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function showSegmentChart(segment: any): boolean {
  return !!(
    segment.geometry &&
    (segment.totalElevationGain ||
      segment.totalElevationLoss ||
      segment.edgeSegments?.length) &&
    (segment.mode === 'walking' ||
      segment.mode === 'cycling' ||
      segment.mode === 'wheelchair')
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hasSegmentRouteInfo(segment: any): boolean {
  return !!(
    segment.totalElevationGain ||
    segment.totalElevationLoss ||
    showSegmentChart(segment)
  )
}

function getInstructionIcon(instruction: string | RouteInstruction) {
  if (typeof instruction === 'string') return ArrowUp
  if (instruction.type === 'arrive' || instruction.type === 'destination')
    return FlagIcon
  switch (instruction.modifier) {
    case 'left': return ArrowLeft
    case 'right': return ArrowRight
    case 'straight': return ArrowUp
    case 'slight-left': return ArrowUpLeft
    case 'slight-right': return ArrowUpRight
    case 'u-turn': return Undo2Icon
    default: return ArrowUp
  }
}

const instructionKey = (index: number) => `${props.segmentIndex}-${index}`
</script>

<template>
  <Collapsible
    v-if="hasSegmentRouteInfo(segment) || segment.instructions?.length"
    v-slot="{ open }"
    class="mt-2"
  >
    <CollapsibleTrigger
      class="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
    >
      <ChevronDownIcon class="size-3 transition-transform" :class="open && 'rotate-180'" />
      <span>{{ open ? 'Hide details' : 'Details' }}</span>
      <span
        v-if="!open && segment.instructions?.length"
        class="font-normal text-muted-foreground/70"
      >· {{ segment.instructions.length }} steps</span>
    </CollapsibleTrigger>

    <CollapsibleContent>
      <!-- Stats + elevation -->
      <div
        v-if="hasSegmentRouteInfo(segment)"
        class="mt-2 rounded-lg border bg-card p-3.5 space-y-3"
      >
        <div
          v-if="segment.totalElevationGain || segment.totalElevationLoss"
          class="grid grid-cols-3 gap-2 pb-3 border-b"
        >
          <StatTile
            variant="bare"
            label="Distance"
            :value="formatDistanceDisplay(segment.distance)"
          />
          <StatTile
            v-if="segment.totalElevationGain"
            variant="bare"
            label="Ascent"
            :value="formatElevation(segment.totalElevationGain)"
          />
          <StatTile
            v-if="segment.totalElevationLoss"
            variant="bare"
            label="Descent"
            :value="formatElevation(segment.totalElevationLoss)"
          />
        </div>

        <ElevationChart
          v-if="showSegmentChart(segment)"
          :segment-index="segmentIndex"
          :geometry="segment.geometry!"
          :max-elevation="segment.maxElevation"
          :min-elevation="segment.minElevation"
          :edge-segments="segment.edgeSegments"
          :mode="segment.mode"
          :total-elevation-gain="segment.totalElevationGain"
          :total-elevation-loss="segment.totalElevationLoss"
          @update:route-profile="(...args) => emit('update:routeProfile', ...args)"
        />
      </div>

      <!-- Turn-by-turn -->
      <div v-if="segment.instructions?.length" class="mt-2">
        <div
          v-for="(instruction, index) in segment.instructions"
          :key="index"
          class="step-row"
          :class="{ 'step-row-active': hoveredKey === instructionKey(Number(index)) }"
          @mouseenter="emit('hoverInstruction', segmentIndex, Number(index), instruction)"
          @mouseleave="emit('leaveInstruction')"
        >
          <span class="step-num">{{ Number(index) + 1 }}</span>
          <span class="step-icon">
            <component :is="getInstructionIcon(instruction)" class="size-3.5" />
          </span>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium text-foreground leading-snug">
              {{ typeof instruction === 'string' ? instruction : instruction.text }}
            </div>
            <div
              v-if="typeof instruction === 'object' && instruction.streetName"
              class="text-[11px] text-muted-foreground mt-0.5"
            >
              {{ instruction.streetName }}
            </div>
          </div>
          <span v-if="typeof instruction === 'object'" class="step-dist">
            {{ formatDistanceDisplay(instruction.distance) }}
            <template v-if="instruction.duration">
              · {{ formatDurationCompact(instruction.duration) }}
            </template>
          </span>
        </div>
      </div>
    </CollapsibleContent>
  </Collapsible>
</template>

<style scoped>
/* Moved verbatim from TripDetail, which no longer renders these rows. */
.step-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 8px 4px;
  margin: 0 -4px;
  cursor: default;
  border-radius: 6px;
  transition: background 0.1s;
}
.step-row:hover,
.step-row-active {
  background: hsl(var(--muted) / 0.5);
}
.step-num {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
  width: 16px;
  flex: none;
  text-align: right;
  color: hsl(var(--muted-foreground));
  font-weight: 500;
  line-height: 1.5;
  padding-top: 3px;
  font-variant-numeric: tabular-nums;
}
.step-icon {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  flex: none;
  background: hsl(var(--muted));
  display: flex;
  align-items: center;
  justify-content: center;
  color: hsl(var(--muted-foreground));
}
.step-dist {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
  color: hsl(var(--muted-foreground));
  font-variant-numeric: tabular-nums;
  text-align: right;
  flex: none;
  padding-top: 3px;
  white-space: nowrap;
}
</style>
