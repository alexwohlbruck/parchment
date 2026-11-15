<script setup lang="ts">
import { computed, ref, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  BikeIcon,
  BookmarkIcon,
  CarIcon,
  ChevronDownIcon,
  ClockIcon,
  CloudSunIcon,
  InfoIcon,
  LayoutListIcon,
  MapPinIcon,
  NavigationIcon,
  RouteIcon,
  SearchIcon,
  TagIcon,
  TimerIcon,
  TrainFrontIcon,
  XIcon,
  GlobeIcon,
} from 'lucide-vue-next'
import { Spinner } from '@/components/ui/spinner'
import AskLoader from './AskLoader.vue'
import type { AskStep } from '@/types/ask.types'

const props = defineProps<{
  steps: AskStep[]
  running: boolean
  startedAt: number
  finishedAt?: number
}>()

const { t } = useI18n()

const TOOL_ICONS: Record<string, Component> = {
  find_places: SearchIcon,
  find_categories: TagIcon,
  browse_category: LayoutListIcon,
  get_place: InfoIcon,
  locate: MapPinIcon,
  places_within_reach: TimerIcon,
  search_along_route: RouteIcon,
  plan_trip: NavigationIcon,
  travel_times: ClockIcon,
  transit_trips: TrainFrontIcon,
  transit_departures: TrainFrontIcon,
  weather: CloudSunIcon,
  bikeshare_nearby: BikeIcon,
  saved_places: BookmarkIcon,
  my_vehicles: CarIcon,
  web_search: GlobeIcon,
}

const open = ref(false)
const expanded = computed(() => props.running || open.value)
const current = computed(() => [...props.steps].reverse().find(step => step.status === 'running'))
const seconds = computed(() =>
  Math.max(1, Math.round(((props.finishedAt ?? Date.now()) - props.startedAt) / 1000)),
)
</script>

<template>
  <div class="flex flex-col gap-2">
    <AskLoader v-if="running" :label="current?.label ?? t('ask.starting')" :started-at="startedAt" />

    <button
      v-else-if="steps.length"
      type="button"
      class="self-start flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
      :aria-expanded="open"
      @click="open = !open"
    >
      {{ t('ask.trace.searchedFor', { seconds }) }}
      <ChevronDownIcon class="size-3.5 transition-transform duration-200" :class="open && 'rotate-180'" />
    </button>

    <ol v-if="expanded && steps.length" class="ml-1.5 flex flex-col gap-2 border-l border-border/70 pl-3.5">
      <li
        v-for="step in steps"
        :key="step.id"
        class="flex min-w-0 items-center gap-2 text-[12.5px] animate-[fade-in_200ms_ease-out]"
      >
        <Spinner v-if="step.status === 'running'" class="size-3.5 shrink-0 text-muted-foreground" />
        <XIcon v-else-if="step.status === 'failed'" class="size-3.5 shrink-0 text-destructive" />
        <component :is="TOOL_ICONS[step.tool] ?? SearchIcon" v-else class="size-3.5 shrink-0 text-muted-foreground" />
        <span class="shrink-0 font-medium text-foreground">{{ step.label }}</span>
        <span
          v-if="step.detail"
          class="min-w-0 truncate rounded-md border border-border/60 bg-muted/60 px-1.5 py-px font-mono text-[11px] text-muted-foreground"
        >
          {{ step.detail }}
        </span>
        <span v-if="step.found !== undefined" class="shrink-0 text-muted-foreground">
          {{ t('ask.trace.found', { count: step.found }, step.found) }}
        </span>
      </li>
    </ol>
  </div>
</template>
