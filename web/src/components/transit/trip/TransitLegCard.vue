<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangleIcon, ArrowRight, ChevronDownIcon } from 'lucide-vue-next'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import RouteBullet from '@/components/transit/bullets/RouteBullet.vue'
import RealtimeIndicator from '@/components/transit/departures/RealtimeIndicator.vue'
import DepartureBoard, { type BoardCard } from '@/components/transit/departures/DepartureBoard.vue'
import ServiceAlertRow from '@/components/transit/alerts/ServiceAlertRow.vue'
import ServiceAlertCard from '@/components/transit/alerts/ServiceAlertCard.vue'
import { TRIP_MODE_COLORS, formatClock, segmentRail } from '@/lib/directions/trip-display'
import { getSegmentIcon } from '@/lib/directions/travel-mode-icons'
import { formatDurationCompact } from '@/lib/time-format'
import type { ServiceAlert } from '@/types/transit.types'

const props = defineProps<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  segment: any
  /** Colour of the timeline rail arriving above the card. */
  railAbove?: { class?: HTMLAttributes['class']; style?: HTMLAttributes['style'] }
  alerts?: ServiceAlert[]
  openAlertId?: string | null
  boardCards?: BoardCard[]
  showBoard?: boolean
  boardKey?: string
  busy?: boolean
  /** Live progress: stops reached, counting the boarding stop. */
  passed?: number
}>()

const emit = defineEmits<{
  toggleAlert: [alert: ServiceAlert]
  choose: [ms: number]
}>()

const { t } = useI18n()

function stopClass(index: number) {
  return props.passed != null && index < props.passed - 1 ? 'opacity-40' : ''
}
</script>

<template>
  <div class="rounded-[22px] ring-1 ring-border bg-card">
    <div
      class="flex items-stretch rounded-t-[22px] pl-2"
      :class="!segment.lineColor && 'bg-muted/40'"
      :style="segment.lineColor ? { background: `#${segment.lineColor}1f` } : {}"
    >
      <div class="relative flex flex-col items-center justify-center w-7 shrink-0">
        <div
          class="absolute left-1/2 -translate-x-1/2 w-0.5 top-[-2px] h-[calc(50%+2px)]"
          :class="railAbove?.class"
          :style="railAbove?.style"
        />
        <div
          class="absolute left-1/2 -translate-x-1/2 w-0.5 top-1/2 bottom-[-2px]"
          v-bind="segmentRail(segment)"
        />
        <div
          class="relative z-10 size-7 rounded-full flex items-center justify-center text-white shrink-0"
          :class="!segment.lineColor && (TRIP_MODE_COLORS[segment.mode as keyof typeof TRIP_MODE_COLORS] || 'bg-parchment-500')"
          :style="segment.lineColor ? {
            background: `#${segment.lineColor}`,
            color: segment.lineTextColor ? `#${segment.lineTextColor}` : '#fff',
          } : {}"
        >
          <component
            :is="getSegmentIcon(segment.mode, segment.routeType)"
            class="size-3.5"
          />
        </div>
      </div>
      <div class="flex-1 min-w-0 flex items-center gap-2 py-2 pl-2.5 pr-3">
      <div
        v-if="(segment.routeOptions?.length ?? 0) > 1"
        class="flex items-center gap-1 shrink-0"
      >
        <RouteBullet
          v-for="opt in (segment.routeOptions as { shortName?: string; color?: string; textColor?: string }[])"
          :key="opt.shortName"
          size="md"
          :label="opt.shortName"
          :color="opt.color"
          :text-color="opt.textColor"
        />
      </div>
      <RouteBullet
        v-else
        size="md"
        class="shrink-0 max-w-[60%]"
        :label="segment.lineName"
        :color="segment.lineColor"
        :text-color="segment.lineTextColor"
      />
      <ArrowRight class="size-3.5 text-muted-foreground shrink-0" />
      <span class="text-sm font-semibold text-foreground truncate">
        {{ segment.headsign || segment.lineLongName }}
      </span>
      <span
        v-if="segment.tripShortName"
        class="text-xs text-muted-foreground tabular-nums whitespace-nowrap shrink-0"
      >
        {{ t('directions.trainNumber', { number: segment.tripShortName }) }}
      </span>
      <RealtimeIndicator
        v-if="segment.realTimeData"
        :real-time="true"
        :delay="segment.delay"
        :color="segment.lineColor ? `#${segment.lineColor}` : undefined"
        class="ml-auto shrink-0"
      />
      </div>
    </div>
    <div class="relative py-2.5 pl-2 pr-3">
      <div
        class="absolute left-[22px] -translate-x-1/2 w-0.5 top-[-2px] bottom-[-2px]"
        v-bind="segmentRail(segment)"
      />
      <div class="space-y-2">
      <div v-if="segment.departureStop" class="relative flex transition-opacity" :class="stopClass(0)">
        <div class="flex flex-col items-center w-7 shrink-0">
          <div
            class="mt-[5px] size-2.5 rounded-full shrink-0"
            v-bind="segmentRail(segment)"
          />
        </div>
        <div class="flex-1 min-w-0 flex items-start justify-between gap-3 pl-2.5">
          <div class="min-w-0">
            <div class="text-sm font-medium text-foreground leading-snug">
              {{ segment.departureStop.name }}
            </div>
            <div class="text-[11px] text-muted-foreground mt-px">
              Board<span v-if="segment.departureStop.platformCode"> · Platform {{ segment.departureStop.platformCode }}</span>
            </div>
          </div>
          <div class="text-sm font-semibold tabular-nums shrink-0">
            {{ formatClock(new Date(segment.startTime)) }}
          </div>
        </div>
      </div>
      <div v-if="alerts ?? [].length" class="relative flex">
        <div class="w-7 shrink-0" />
        <div class="flex-1 min-w-0 pl-2.5 space-y-1.5">
          <template
            v-for="alert in alerts ?? []"
            :key="alert.id"
          >
            <ServiceAlertRow
              :alert="alert"
              :when="null"
              :expanded="alert.id === openAlertId"
              @toggle="emit('toggleAlert', alert)"
            />
            <ServiceAlertCard
              v-if="alert.id === openAlertId"
              :alert="alert"
            />
          </template>
        </div>
      </div>
      <div v-if="showBoard" class="relative flex">
        <div class="w-7 shrink-0" />
        <div class="flex-1 min-w-0 pl-2.5">
          <DepartureBoard
            :key="boardKey"
            :cards="boardCards ?? []"
            :line-color="segment.lineColor"
            :line-text-color="segment.lineTextColor"
            :line-name="segment.lineName"
            :busy="busy"
            @choose="ms => emit('choose', ms)"
          />
        </div>
      </div>
      <Collapsible
        v-if="segment.intermediateStops?.length"
        v-slot="{ open }"
        :default-open="passed != null"
        class="relative"
      >
        <CollapsibleTrigger class="group/stops flex w-full transition-colors cursor-pointer select-none">
          <div class="w-7 shrink-0" />
          <span class="flex flex-1 items-center gap-1.5 ml-2.5 px-2.5 min-h-9 pointer-coarse:min-h-11 rounded-md border bg-card text-xs font-medium text-muted-foreground group-hover/stops:text-foreground group-hover/stops:bg-secondary/40 transition-colors">
            <ChevronDownIcon class="size-3.5 transition-transform" :class="open && 'rotate-180'" />
            <span>{{ segment.intermediateStops.length }} stops · {{ formatDurationCompact(segment.duration) }}</span>
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div class="pt-1.5 space-y-1">
            <div
              v-for="(stop, si) in (segment.intermediateStops as { id?: string; name: string; arrivalTime?: string }[])"
              :key="stop.id || stop.name"
              class="flex transition-opacity"
              :class="stopClass(si + 1)"
            >
              <div class="flex flex-col items-center w-7 shrink-0">
                <div
                  class="mt-[5px] size-1.5 rounded-full shrink-0"
                  v-bind="segmentRail(segment)"
                />
              </div>
              <div
                class="flex-1 min-w-0 flex items-center gap-2 pl-2.5 text-xs"
                :class="passed === si + 1 ? 'text-foreground font-medium' : 'text-muted-foreground'"
              >
                <span class="flex-1 truncate">{{ stop.name }}</span>
                <span v-if="stop.arrivalTime" class="text-[10px] tabular-nums shrink-0">
                  {{ formatClock(new Date(stop.arrivalTime)) }}
                </span>
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
      <div v-if="segment.arrivalStop" class="relative flex">
        <div class="flex flex-col items-center w-7 shrink-0">
          <div
            class="mt-[5px] size-2.5 rounded-full shrink-0"
            v-bind="segmentRail(segment)"
          />
        </div>
        <div class="flex-1 min-w-0 flex items-start justify-between gap-3 pl-2.5">
          <div class="min-w-0">
            <div class="text-sm font-medium text-foreground leading-snug">
              {{ segment.arrivalStop.name }}
            </div>
            <div class="text-[11px] text-muted-foreground mt-px">
              Alight<span v-if="segment.arrivalStop.platformCode"> · Platform {{ segment.arrivalStop.platformCode }}</span>
            </div>
          </div>
          <span class="text-sm font-semibold tabular-nums shrink-0">
            {{ formatClock(new Date(segment.endTime)) }}
          </span>
        </div>
      </div>
      <div
        v-for="(alert, ai) in segment.transitDetails?.alerts ?? []"
        :key="ai"
        class="ml-[38px] flex gap-2 p-2 rounded-md text-xs"
        :class="alert.severity === 'severe'
          ? 'bg-destructive/10 text-destructive'
          : alert.severity === 'warning'
            ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400'
            : 'bg-muted text-muted-foreground'"
      >
        <AlertTriangleIcon class="size-3.5 shrink-0 mt-0.5" />
        <div>
          <div v-if="alert.headerText" class="font-medium">{{ alert.headerText }}</div>
          <div v-if="alert.descriptionText" class="mt-0.5 line-clamp-3">{{ alert.descriptionText }}</div>
        </div>
      </div>
      </div>
    </div>
  </div>
</template>
