<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  AccessibilityIcon,
  ArrowRight,
  BikeIcon,
  CarTaxiFrontIcon,
  ClockIcon,
  ExternalLinkIcon,
  LogInIcon,
  LogOutIcon,
  TriangleAlertIcon,
} from 'lucide-vue-next'
import {
  TRIP_MODE_COLORS,
  entrancePhrase,
  formatClock,
  formatFareBreakdown,
  formatRentalFare,
  movingDuration,
  railColorAt,
  railStyleAt,
  segmentRail,
  waitMinutes,
} from '@/lib/directions/trip-display'
import { tightChanges } from '@/lib/directions/trip-advice'
import { tripPlaceStops, type TripPlaceStop } from '@/lib/directions/trip-stops'
import { getSegmentIcon } from '@/lib/directions/travel-mode-icons'
import type { RouteProfileType } from '@/lib/directions/route-profile-colors'
import type { TransitStage } from '@/lib/guidance/transit-progress'
import { getSearchResultCategory, getSearchResultIconName, getSearchResultIconPack } from '@/lib/search/search-result'
import { boardingSign, stationSignText } from '@/lib/transit/station/station-signs'
import { formatDurationCompact } from '@/lib/time-format'
import { getCategoryColor } from '@/services/place/place-colors'
import { waypointToDisplay } from '@/services/place/place-display'
import { useThemeStore } from '@/stores/theme.store'
import { useUnits } from '@/composables/useUnits'
import type { RouteWaypointDisplay } from '@/composables/directions/useRouteWaypoints'
import { ItemIcon } from '@/components/ui/item-icon'
import { PlaceCard } from '@/components/place/card'
import TransitLegCard from '@/components/transit/trip/TransitLegCard.vue'
import StationGuidanceRows from '@/components/transit/trip/StationGuidanceRows.vue'
import type { BoardCard } from '@/components/transit/departures/DepartureBoard.vue'
import type { RouteInstruction } from '@/types/directions.types'
import type { ServiceAlert } from '@/types/transit.types'
import SegmentDetails from './SegmentDetails.vue'
import HazardSummary from './HazardSummary.vue'

const props = defineProps<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  segments: any[]
  waypoints: RouteWaypointDisplay[]
  startTime?: Date | string
  endTime?: Date | string
  alerts?: (segmentIndex: number) => ServiceAlert[]
  openAlertId?: string | null
  boardCards?: Record<number, BoardCard[]>
  boardShown?: (segmentIndex: number) => boolean
  boardKey?: string
  busy?: boolean
  hoveredInstructionKey?: string | null
  detailedHazards?: boolean
  /** Live: the segment the traveller is on. Everything before it is behind them. */
  current?: number
  stage?: TransitStage | null
}>()

const emit = defineEmits<{
  toggleAlert: [alert: ServiceAlert]
  chooseDeparture: [segmentIndex: number, ms: number]
  hoverInstruction: [segmentIndex: number, instructionIndex: number, instruction: string | RouteInstruction]
  leaveInstruction: []
  routeProfileChange: [segmentIndex: number, profile: RouteProfileType | null]
}>()

const { t: translate } = useI18n()
const themeStore = useThemeStore()
const { formatDistance } = useUnits()

const formatTime = (date: Date | string) => formatClock(new Date(date))
const formatDistanceDisplay = (meters: number | undefined) => formatDistance(meters ?? 0)

const modeTextColors: Record<string, string> = {
  walking: 'text-cobalt-500',
  driving: 'text-violet-500',
  cycling: 'text-forest-500',
  biking: 'text-forest-500',
  transit: 'text-parchment-600',
  truck: 'text-compass-500',
}

const tight = computed(() => tightChanges(props.segments))

/** What the closing step of a walk into a ride says: the station's signs, or the stop's name. */
function walkArrival(index: number) {
  const next = props.segments[index + 1]
  if (next?.mode !== 'transit') return null
  const sign = boardingSign(props.segments, index)
  if (sign) return { text: stationSignText(sign, translate), sign: true }
  return next.departureStop?.name ? { text: translate('directions.arriveAtStop', { stop: next.departureStop.name }), sign: false } : null
}

interface WaypointEntry {
  kind: 'waypoint'
  wp: RouteWaypointDisplay
  waypointIndex: number
  /** The segment this stop follows; -1 for the start. */
  after: number
}

interface SegmentEntry {
  kind: 'segment'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  segment: any
  segmentIndex: number
}

interface PlaceStopEntry extends TripPlaceStop {
  kind: 'place-stop'
}

type TimelineEntry = WaypointEntry | SegmentEntry | PlaceStopEntry

const entries = computed<TimelineEntry[]>(() => {
  const segs = props.segments
  const wps = props.waypoints
  const placeStops = new Map(tripPlaceStops(segs).map(s => [s.segmentIndex, s]))
  const display = (place: RouteWaypointDisplay['place'], fallbackTitle: string) =>
    waypointToDisplay(place, { isDark: themeStore.isDark, t: translate, fallbackTitle })

  const origin = wps.find(w => w.role === 'origin')
  const list: TimelineEntry[] = [{
    kind: 'waypoint',
    waypointIndex: 0,
    after: -1,
    wp: origin ?? {
      id: 'origin',
      role: 'origin',
      displayName: '',
      time: segs[0]?.startTime ?? props.startTime ?? null,
      ...display(null, 'Origin'),
    },
  }]

  for (let i = 0; i < segs.length; i++) {
    list.push({ kind: 'segment', segment: segs[i], segmentIndex: i })

    const stop = placeStops.get(i)
    if (stop) list.push({ kind: 'place-stop', ...stop })

    // A stop sits at the end of its leg, not after every segment.
    const nextSeg = segs[i + 1]
    const viaIndex = nextSeg ? nextSeg.legIndex ?? 0 : null
    if (viaIndex !== null && viaIndex !== (segs[i].legIndex ?? 0) && viaIndex < wps.length - 1) {
      const via = wps[viaIndex]
      if (via?.role === 'via') list.push({ kind: 'waypoint', wp: via, waypointIndex: viaIndex, after: i })
    }
  }

  const last = segs.at(-1)
  const dest = wps.find(w => w.role === 'destination')
  list.push({
    kind: 'waypoint',
    waypointIndex: Math.max(wps.length - 1, 1),
    after: segs.length - 1,
    wp: dest ?? {
      id: 'destination',
      role: 'destination',
      displayName: last?.end?.label ?? '',
      time: last?.endTime ?? props.endTime ?? null,
      ...display(last?.end?.place ?? null, last?.end?.label || 'Destination'),
    },
  })
  return list
})

/** A ride on a named line is a card the rail runs through, so its row skips the rail column. */
function isTransitCard(entry: TimelineEntry): boolean {
  return entry.kind === 'segment' && entry.segment.mode === 'transit' && !!entry.segment.lineName
}

function segmentAfter(entry: TimelineEntry): number {
  if (entry.kind === 'waypoint') return entry.after
  return entry.segmentIndex
}

function isPast(entry: TimelineEntry): boolean {
  if (props.current == null) return false
  const at = segmentAfter(entry)
  return entry.kind === 'segment' ? at < props.current : at < props.current && at < props.segments.length - 1
}

function passedStops(segmentIndex: number): number | undefined {
  if (props.current == null) return undefined
  const stage = props.stage
  if (stage?.kind === 'riding' && stage.segmentIndex === segmentIndex) return stage.passed
  return segmentIndex < props.current ? Infinity : undefined
}

/** Tags a rail node with the point of the route it stands for. */
function node(index: number) {
  const entry = entries.value[index]
  if (entry.kind === 'segment') return { 'data-node-segment': entry.segmentIndex, 'data-node-at': 'start' }
  const next = entries.value.slice(index + 1).find(e => e.kind === 'segment') as SegmentEntry | undefined
  return next
    ? { 'data-node-segment': next.segmentIndex, 'data-node-at': 'start' }
    : { 'data-node-segment': segmentAfter(entry), 'data-node-at': 'end' }
}
</script>

<template>
  <div>
    <div
      v-for="(entry, i) in entries"
      :key="entry.kind === 'waypoint' ? entry.wp.id : entry.kind === 'place-stop' ? `place-${entry.id}` : `seg-${entry.segmentIndex}`"
      class="flex transition-opacity"
      :class="[!isTransitCard(entry) && 'pl-2', isPast(entry) && 'opacity-50']"
    >
      <div
        v-if="!isTransitCard(entry)"
        class="relative flex flex-col items-center w-7 shrink-0"
      >
        <template v-if="entry.kind === 'waypoint'">
          <!-- Rails overlap 2px past each entry to hide sub-pixel seams. -->
          <div
            v-if="i > 0"
            class="absolute left-1/2 -translate-x-1/2 w-0.5 top-[-2px] h-[20px]"
            :class="railColorAt(entries, i, 'above')"
          />
          <div
            v-if="i < entries.length - 1"
            class="absolute left-1/2 -translate-x-1/2 w-0.5 top-[18px] bottom-[-2px]"
            :class="railColorAt(entries, i, 'above')"
          />
          <ItemIcon
            v-if="entry.waypointIndex > 0 || entry.wp.ownIcon"
            v-bind="node(i)"
            :icon="entry.wp.display.icon"
            :icon-pack="entry.wp.display.iconPack"
            :color="entry.wp.display.color"
            :custom-color="entry.wp.display.customColor"
            :image-url="entry.wp.display.imageUrl ?? undefined"
            size="sm"
            variant="solid"
            shape="circle"
            class="relative z-10 mt-1 !size-7 shrink-0 ring-2 ring-muted-light"
          />
          <div
            v-else
            v-bind="node(i)"
            class="relative z-10 mt-1 size-7 flex items-center justify-center shrink-0"
          >
            <div
              class="size-4 rounded-full bg-background border-[1.5px] border-foreground/60 ring-2 ring-muted-light"
            />
          </div>
        </template>
        <template v-else-if="entry.kind === 'place-stop'">
          <div
            v-if="i > 0"
            class="absolute left-1/2 -translate-x-1/2 w-0.5 top-[-2px] h-[20px]"
            :class="railColorAt(entries, i, 'above')"
            :style="railStyleAt(entries, i, 'above')"
          />
          <div
            v-if="i < entries.length - 1"
            class="absolute left-1/2 -translate-x-1/2 w-0.5 top-[18px] bottom-[-2px]"
            :class="railColorAt(entries, i, 'below')"
            :style="railStyleAt(entries, i, 'below')"
          />
          <ItemIcon
            v-bind="node(i)"
            :icon="getSearchResultIconName(entry.place)"
            :icon-pack="getSearchResultIconPack(entry.place)"
            :custom-color="getCategoryColor(getSearchResultCategory(entry.place), themeStore.isDark)"
            size="sm"
            variant="solid"
            shape="circle"
            class="relative z-10 mt-1 !size-7 shrink-0 ring-2 ring-muted-light"
          />
        </template>
        <template v-else-if="entry.kind === 'segment'">
          <div
            class="absolute left-1/2 -translate-x-1/2 w-0.5 top-[-2px] h-[21px]"
            :class="railColorAt(entries, i, 'above')"
            :style="railStyleAt(entries, i, 'above')"
          />
          <div
            v-if="i < entries.length - 1"
            class="absolute left-1/2 -translate-x-1/2 w-0.5 top-[19px] bottom-[-2px]"
            :class="!entry.segment.lineColor && (TRIP_MODE_COLORS[entry.segment.mode as keyof typeof TRIP_MODE_COLORS] || 'bg-parchment-500')"
            :style="entry.segment.lineColor ? { background: `#${entry.segment.lineColor}` } : {}"
          />
          <div
            v-bind="node(i)"
            class="relative z-10 mt-[5px] shrink-0 size-7 rounded-full flex items-center justify-center text-white"
            :class="!entry.segment.lineColor && (TRIP_MODE_COLORS[entry.segment.mode as keyof typeof TRIP_MODE_COLORS] || 'bg-parchment-500')"
            :style="entry.segment.lineColor ? {
              background: `#${entry.segment.lineColor}`,
              color: entry.segment.lineTextColor ? `#${entry.segment.lineTextColor}` : '#fff',
            } : {}"
          >
            <component
              :is="getSegmentIcon(entry.segment.mode, entry.segment.routeType)"
              class="size-3.5"
            />
          </div>
        </template>
      </div>
      <div
        class="flex-1 min-w-0"
        :class="isTransitCard(entry)
          ? 'pb-5'
          : entry.kind === 'segment' ? 'pl-2.5 pb-5' : 'pl-2.5 pb-4'"
      >
        <template v-if="entry.kind === 'waypoint'">
          <PlaceCard
            :display="entry.wp.display"
            variant="plain"
            size="sm"
            density="compact"
            :show-icon="false"
            class="-mx-2"
          >
            <template v-if="entry.wp.time" #title-trailing>
              <span class="text-xs font-medium tabular-nums text-muted-foreground shrink-0">
                {{ formatTime(entry.wp.time) }}
              </span>
            </template>
          </PlaceCard>
        </template>
        <template v-else-if="entry.kind === 'place-stop'">
          <PlaceCard
            :place="entry.place"
            :title="entry.label || undefined"
            variant="plain"
            size="sm"
            density="compact"
            :show-icon="false"
            class="-mx-2"
          >
            <template v-if="entry.time" #title-trailing>
              <span class="text-xs font-medium tabular-nums text-muted-foreground shrink-0">
                {{ formatTime(entry.time) }}
              </span>
            </template>
          </PlaceCard>
        </template>
        <template v-else-if="entry.kind === 'segment'">
          <div v-if="entry.segment.mode === 'transit' && entry.segment.lineName">
            <!-- The rail arriving at this leg runs past the change advice and the
                 station guidance to the card. flow-root keeps the rows' bottom
                 margin inside this box, so the rail reaches the card's own. -->
            <div class="relative flow-root">
              <div
                v-if="i > 0"
                class="absolute left-[22px] -translate-x-1/2 w-0.5 top-[-2px] bottom-[-2px]"
                :class="railColorAt(entries, i, 'above')"
                :style="railStyleAt(entries, i, 'above')"
              />
              <p
                v-if="tight.has(entry.segmentIndex)"
                class="mb-2 pl-[46px] flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300"
              >
                <TriangleAlertIcon class="size-3.5 shrink-0" />
                {{ translate('directions.advice.tightChangeHere', { minutes: tight.get(entry.segmentIndex)!.minutes }) }}
              </p>
              <StationGuidanceRows
                class="mb-2 pl-[46px]"
                :segments="segments"
                :index="entry.segmentIndex"
              />
            </div>
            <!-- A ring, not a border: a border would shift the rail inside the card 1px right. -->
            <TransitLegCard
              :data-segment-card="entry.segmentIndex"
              :segment="entry.segment"
              :rail-above="{ class: railColorAt(entries, i, 'above'), style: railStyleAt(entries, i, 'above') }"
              :alerts="alerts?.(entry.segmentIndex)"
              :open-alert-id="openAlertId"
              :board-cards="boardCards?.[entry.segmentIndex] ?? []"
              :show-board="!!boardShown?.(entry.segmentIndex)"
              :board-key="`${boardKey}-${entry.segmentIndex}`"
              :busy="busy"
              :passed="passedStops(entry.segmentIndex)"
              @toggle-alert="alert => emit('toggleAlert', alert)"
              @choose="ms => emit('chooseDeparture', entry.segmentIndex, ms)"
            />
            <div class="relative mt-1.5 pl-[46px]">
              <div
                v-if="i < entries.length - 1"
                class="absolute left-[22px] -translate-x-1/2 w-0.5 top-[-8px] bottom-[-22px]"
                v-bind="segmentRail(entry.segment)"
              />
              <div class="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                <span class="tabular-nums">{{ formatDurationCompact(entry.segment.duration) }} · {{ formatDistanceDisplay(entry.segment.distance) }}</span>
                <span v-if="entry.segment.agencyName">· {{ entry.segment.agencyName }}</span>
                <span
                  v-if="entry.segment.carryingVehicle"
                  class="inline-flex items-center gap-1 text-forest-600 dark:text-forest-400"
                >
                  <BikeIcon class="size-3" /> Bring bike on board
                </span>
              </div>
            </div>
          </div>
          <div v-else-if="entry.segment.mode === 'rideshare' && entry.segment.rideshareDetails">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span class="inline-flex items-center gap-1.5 text-sm font-semibold">
                <CarTaxiFrontIcon class="size-4" />
                {{ entry.segment.rideshareDetails.provider }}
                <span v-if="entry.segment.rideshareDetails.productName" class="font-normal text-muted-foreground">
                  {{ entry.segment.rideshareDetails.productName }}
                </span>
              </span>
            </div>
            <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              <span v-if="entry.segment.rideshareDetails.priceRange" class="font-semibold text-foreground">
                ${{ entry.segment.rideshareDetails.priceRange.low.value.toFixed(0) }}–${{ entry.segment.rideshareDetails.priceRange.high.value.toFixed(0) }}
              </span>
              <span v-if="entry.segment.rideshareDetails.surgeMultiplier && entry.segment.rideshareDetails.surgeMultiplier > 1"
                class="text-amber-500 font-medium"
              >
                {{ entry.segment.rideshareDetails.surgeMultiplier.toFixed(1) }}× surge
              </span>
              <span v-if="entry.segment.rideshareDetails.pickupEta" class="inline-flex items-center gap-1">
                <ClockIcon class="size-3" />
                {{ Math.ceil(entry.segment.rideshareDetails.pickupEta / 60) }} min pickup
              </span>
              <span>{{ formatDurationCompact(entry.segment.duration) }}</span>
            </div>
            <a
              v-if="entry.segment.rideshareDetails.bookingUrl"
              :href="entry.segment.rideshareDetails.bookingUrl"
              target="_blank"
              class="mt-1.5 inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Book in {{ entry.segment.rideshareDetails.provider }} →
            </a>
          </div>
          <div v-else>
            <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span
                :class="[
                  'text-sm font-semibold capitalize',
                  modeTextColors[entry.segment.mode] || 'text-foreground',
                ]"
              >
                {{ entry.segment.ownership === 'shared'
                  ? (entry.segment.sharedMobilityDetails?.vehicleType === 'scooter' ? 'Scootershare' : 'Bikeshare')
                  : entry.segment.mode }}
              </span>
              <span
                v-if="entry.segment.ownership === 'shared'"
                class="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300"
              >
                Shared
              </span>
              <span class="text-sm text-muted-foreground">
                {{ formatDurationCompact(movingDuration(entry.segment)) }} · {{ formatDistanceDisplay(entry.segment.distance) }}
              </span>
            </div>
            <div
              v-if="entrancePhrase(entry.segment.stationEntrance)"
              class="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground"
            >
              <component
                :is="entry.segment.stationEntrance.accessType === 'elevator'
                  ? AccessibilityIcon
                  : entry.segment.stationEntrance.role === 'exit'
                    ? LogOutIcon
                    : LogInIcon"
                class="size-3 shrink-0"
              />
              <span>{{ entrancePhrase(entry.segment.stationEntrance) }}</span>
            </div>
            <StationGuidanceRows
              class="mt-1.5"
              :segments="segments"
              :index="entry.segmentIndex"
            />
            <!-- Walk times are implied by the surrounding stops. -->
            <div
              v-if="entry.segment.mode !== 'walking' && entry.segment.startTime && entry.segment.endTime"
              class="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground tabular-nums"
            >
              <ClockIcon class="size-3" />
              {{ formatTime(entry.segment.startTime) }} – {{ formatTime(entry.segment.endTime) }}
            </div>
            <div
              v-if="waitMinutes(entry.segment)"
              class="mt-0.5 text-xs text-muted-foreground"
            >
              then wait {{ waitMinutes(entry.segment) }} min
            </div>
          </div>
          <div
            v-if="entry.segment.sharedMobilityDetails"
            class="mt-2 rounded-lg border bg-teal-50 dark:bg-teal-900/20 p-3 space-y-2"
          >
            <div class="flex items-center justify-between">
              <div>
                <div v-if="entry.segment.sharedMobilityDetails.stationName" class="text-sm font-medium">
                  {{ entry.segment.sharedMobilityDetails.stationName }}
                  <template v-if="entry.segment.sharedMobilityDetails.toStationName">
                    <ArrowRight class="inline size-3 mx-0.5 text-muted-foreground" />
                    {{ entry.segment.sharedMobilityDetails.toStationName }}
                  </template>
                </div>
                <div class="text-xs text-muted-foreground">
                  {{ entry.segment.sharedMobilityDetails.provider }}
                  <span v-if="entry.segment.sharedMobilityDetails.propulsionType === 'electric_assist'"> · e-bike</span>
                </div>
              </div>
              <div
                v-if="entry.segment.sharedMobilityDetails.availableVehicles != null"
                class="text-xs text-teal-700 dark:text-teal-300 font-medium"
              >
                {{ entry.segment.sharedMobilityDetails.availableVehicles }} available
              </div>
            </div>
            <div
              v-if="entry.segment.sharedMobilityDetails.pricing"
              class="flex items-baseline justify-between gap-2 border-t border-teal-200/60 dark:border-teal-800/40 pt-2"
            >
              <span class="text-sm font-semibold text-teal-800 dark:text-teal-200">
                {{ formatRentalFare(entry.segment.sharedMobilityDetails.pricing) }}
              </span>
              <span class="text-xs text-muted-foreground text-right">
                {{ formatFareBreakdown(entry.segment.sharedMobilityDetails.pricing) }}
              </span>
            </div>
            <a
              v-if="entry.segment.sharedMobilityDetails.unlockUri"
              :href="entry.segment.sharedMobilityDetails.unlockUri"
              target="_blank"
              rel="noopener"
              class="flex items-center justify-center gap-2 w-full py-2 px-3 rounded-md bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium transition-colors"
            >
              Unlock in {{ entry.segment.sharedMobilityDetails.provider }}
              <ExternalLinkIcon class="size-3.5" />
            </a>
          </div>
          <HazardSummary
            v-if="entry.segment.hazards?.length"
            :hazards="entry.segment.hazards"
            :detailed="detailedHazards"
          />
          <SegmentDetails
            :segment="entry.segment"
            :segment-index="entry.segmentIndex"
            :hovered-key="hoveredInstructionKey ?? null"
            :arrival="walkArrival(entry.segmentIndex)"
            @hover-instruction="(...args) => emit('hoverInstruction', ...args)"
            @leave-instruction="emit('leaveInstruction')"
            @update:route-profile="(index, profile) => emit('routeProfileChange', index, profile)"
          />
        </template>
      </div>
    </div>
  </div>
</template>
