<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  AccessibilityIcon,
  ArrowRight,
  BikeIcon,
  CarFrontIcon,
  ClockIcon,
  ExternalLinkIcon,
  LogInIcon,
  LogOutIcon,
  TriangleAlertIcon,
} from 'lucide-vue-next'
import {
  entrancePhrase,
  formatClock,
  formatFareBreakdown,
  formatRentalFare,
  railColorAt,
  railStyleAt,
  waitMinutes,
} from '@/lib/directions/trip-display'
import { tightChanges } from '@/lib/directions/trip-advice'
import { tripPlaceStops, type TripPlaceStop } from '@/lib/directions/trip-stops'
import type { RouteProfileType } from '@/lib/directions/route-profile-colors'
import type { TransitStage } from '@/lib/guidance/transit-progress'
import { getSearchResultCategory, getSearchResultIconName, getSearchResultIconPack } from '@/lib/search/search-result'
import { boardingSign, stationSignText } from '@/lib/transit/station/station-signs'
import { getCategoryColor } from '@/services/place/place-colors'
import { placeToDisplay, waypointToDisplay } from '@/services/place/place-display'
import { useThemeStore } from '@/stores/theme.store'
import type { RouteWaypointDisplay } from '@/composables/directions/useRouteWaypoints'
import { ItemIcon } from '@/components/ui/item-icon'
import WaypointNode from './WaypointNode.vue'
import { PlaceCard } from '@/components/place/card'
import TransitLegCard from '@/components/transit/trip/TransitLegCard.vue'
import StationGuidanceRows from '@/components/transit/trip/StationGuidanceRows.vue'
import type { BoardCard } from '@/components/transit/departures/DepartureBoard.vue'
import type { RouteInstruction } from '@/types/directions.types'
import type { ServiceAlert } from '@/types/transit.types'
import LegCard from './LegCard.vue'
import HandoffPill from './HandoffPill.vue'

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
  /** Live: metres into the current segment. */
  progress?: number | null
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

const formatTime = (date: Date | string) => formatClock(new Date(date))

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

/** Walking up to your own car or bike, where the next leg starts. */
interface PickupEntry {
  kind: 'pickup'
  segmentIndex: number
  vehicle: string
  label: string | null
  time: string | null
}

type TimelineEntry = WaypointEntry | SegmentEntry | PlaceStopEntry | PickupEntry

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pickupBefore(segments: any[], index: number): PickupEntry | null {
  const segment = segments[index]
  const vehicle = segment.ownership === 'personal' && segment.mode !== 'walking' && segment.mode !== 'transit' ? segment.vehicle?.name : null
  if (!vehicle || segments[index - 1]?.mode !== 'walking') return null
  const label = segment.start?.label && segment.start.label !== vehicle ? segment.start.label : null
  return { kind: 'pickup', segmentIndex: index, vehicle, label, time: segment.startTime ? String(segment.startTime) : null }
}

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
    const pickup = pickupBefore(segs, i)
    if (pickup) list.push(pickup)
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

const isTransitRide = (entry: TimelineEntry) =>
  entry.kind === 'segment' && entry.segment.mode === 'transit' && !!entry.segment.lineName

/** Every leg is a card that draws its own stretch of the rail, so its row skips the rail column. */
const isCard = (entry: TimelineEntry) => entry.kind === 'segment'

function segmentAfter(entry: TimelineEntry): number {
  if (entry.kind === 'waypoint') return entry.after
  return entry.segmentIndex
}

function isPast(entry: TimelineEntry): boolean {
  if (props.current == null) return false
  const at = segmentAfter(entry)
  if (entry.kind === 'pickup') return at <= props.current
  return entry.kind === 'segment' ? at < props.current : at < props.current && at < props.segments.length - 1
}

const pastShown = ref(false)
const hasPast = computed(() => entries.value.some(isPast))

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function verbOf(segment: any): 'walking' | 'cycling' | 'scooter' | 'driving' | null {
  if (segment.mode === 'walking') return 'walking'
  if (segment.mode === 'driving') return 'driving'
  if (segment.mode === 'cycling' || segment.mode === 'biking') {
    return segment.sharedMobilityDetails?.vehicleType === 'scooter' ? 'scooter' : 'cycling'
  }
  return null
}

/** Where a leg takes you: the next stop, ride or vehicle on the timeline. */
function targetOf(index: number): string | null {
  const entry = entries.value[index] as SegmentEntry
  const docked = entry.segment.sharedMobilityDetails?.toStationName
  if (docked) return docked
  const next = entries.value[index + 1]
  if (!next) return null
  if (next.kind === 'place-stop') return next.label
  if (next.kind === 'pickup') return translate('directions.leg.yourVehicle', { vehicle: next.vehicle })
  if (next.kind === 'waypoint') return next.wp.display.title || next.wp.displayName || null
  return next.segment.mode === 'transit' ? next.segment.departureStop?.name ?? null : next.segment.start?.label ?? null
}

function legTitle(index: number): string {
  const entry = entries.value[index] as SegmentEntry
  if (entry.segment.mode === 'rideshare') return entry.segment.rideshareDetails?.provider ?? ''
  const verb = verbOf(entry.segment)
  if (!verb) return entry.segment.mode
  const target = targetOf(index)
  return target ? translate(`directions.leg.to.${verb}`, { place: target }) : translate(`directions.leg.plain.${verb}`)
}

/** What you do at a stop the plan makes for you, from the leg that arrives there. */
function handoffOf(entry: PlaceStopEntry) {
  const mode = props.segments[entry.segmentIndex]?.mode
  const display = placeToDisplay(entry.place, { isDark: themeStore.isDark, t: translate })
  const detail = display.summary ?? display.placeType
  if (mode === 'cycling' || mode === 'biking') return { verb: translate('directions.leg.handoff.lockUp'), label: entry.label, detail }
  if (mode === 'driving') return { verb: translate('directions.leg.handoff.park'), label: entry.label, detail }
  return { verb: entry.label, label: null, detail }
}

const handoffRing = (i: number) => ({ class: railColorAt(entries.value, i, 'above'), style: railStyleAt(entries.value, i, 'above') })

const legKey = (entry: TimelineEntry) => {
  switch (entry.kind) {
    case 'waypoint': return entry.wp.id
    case 'place-stop': return `place-${entry.id}`
    case 'pickup': return `pickup-${entry.segmentIndex}`
    default: return `seg-${entry.segmentIndex}`
  }
}
</script>

<template>
  <div>
    <button
      v-if="hasPast"
      type="button"
      class="flex h-11 w-full cursor-pointer items-center pl-2 text-[13px] font-medium text-primary"
      @click="pastShown = !pastShown"
    >
      {{ pastShown ? translate('directions.leg.hideCompleted') : translate('directions.leg.showCompleted') }}
    </button>
    <div
      v-for="(entry, i) in entries"
      v-show="pastShown || !isPast(entry)"
      :key="legKey(entry)"
      class="flex transition-opacity"
      :class="[!isCard(entry) && 'pl-2', isPast(entry) && 'opacity-50']"
    >
      <div
        v-if="!isCard(entry)"
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
          <WaypointNode v-bind="node(i)" :waypoint="entry.wp" size="rail" class="relative z-10 mt-1" />
        </template>
        <template v-else-if="entry.kind === 'place-stop'">
          <div
            class="absolute left-1/2 -translate-x-1/2 w-0.5 top-[-2px] h-[20px]"
            :class="railColorAt(entries, i, 'above')"
            :style="railStyleAt(entries, i, 'above')"
          />
          <div
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
        <template v-else>
          <div
            class="absolute left-1/2 -translate-x-1/2 w-0.5 top-[-2px] h-[22px]"
            :class="railColorAt(entries, i, 'above')"
            :style="railStyleAt(entries, i, 'above')"
          />
          <div
            class="absolute left-1/2 -translate-x-1/2 w-0.5 top-[20px] bottom-[-2px]"
            :class="railColorAt(entries, i, 'below')"
            :style="railStyleAt(entries, i, 'below')"
          />
          <div
            v-bind="node(i)"
            class="relative z-10 mt-3 size-4 shrink-0 rounded-full p-[3px] ring-2 ring-muted-light"
            :class="handoffRing(i).class"
            :style="handoffRing(i).style"
          >
            <div class="size-full rounded-full bg-muted-light" />
          </div>
        </template>
      </div>
      <div
        class="flex-1 min-w-0"
        :class="isCard(entry) ? '' : 'pl-2.5 pb-3'"
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
              <span class="text-xs font-medium tabular-nums text-foreground shrink-0">
                {{ formatTime(entry.wp.time) }}
              </span>
            </template>
          </PlaceCard>
        </template>
        <template v-else-if="entry.kind === 'place-stop'">
          <PlaceCard
            v-if="handoffOf(entry).verb === entry.label"
            :place="entry.place"
            :title="entry.label || undefined"
            variant="plain"
            size="sm"
            density="compact"
            :show-icon="false"
            class="-mx-2"
          >
            <template v-if="entry.time" #title-trailing>
              <span class="text-xs font-medium tabular-nums text-foreground shrink-0">
                {{ formatTime(entry.time) }}
              </span>
            </template>
          </PlaceCard>
          <HandoffPill
            v-else
            v-bind="handoffOf(entry)"
            :time="entry.time ? formatTime(entry.time) : null"
          />
        </template>
        <HandoffPill
          v-else-if="entry.kind === 'pickup'"
          :icon="CarFrontIcon"
          :verb="translate('directions.leg.handoff.pickUp', { vehicle: entry.vehicle })"
          :label="entry.label"
          :time="entry.time ? formatTime(entry.time) : null"
        />
        <template v-else-if="entry.kind === 'segment'">
          <div v-if="isTransitRide(entry)">
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
            >
              <span
                v-if="entry.segment.carryingVehicle"
                class="inline-flex items-center gap-1 text-forest-600 dark:text-forest-400"
              >
                <BikeIcon class="size-3" /> Bring bike on board
              </span>
            </TransitLegCard>
          </div>
          <LegCard
            v-else
            :segment="entry.segment"
            :segment-index="entry.segmentIndex"
            :title="legTitle(i)"
            :rail-above="i > 0 ? { class: railColorAt(entries, i, 'above'), style: railStyleAt(entries, i, 'above') } : undefined"
            :progress="current === entry.segmentIndex ? progress ?? null : null"
            :hovered-key="hoveredInstructionKey ?? null"
            :detailed-hazards="detailedHazards"
            :arrival="walkArrival(entry.segmentIndex)"
            @hover-instruction="(...args) => emit('hoverInstruction', ...args)"
            @leave-instruction="emit('leaveInstruction')"
            @route-profile-change="(index, profile) => emit('routeProfileChange', index, profile)"
          >
            <div
              v-if="entrancePhrase(entry.segment.stationEntrance)"
              class="mt-1 flex items-center gap-1 text-xs text-muted-foreground"
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
            <div v-if="waitMinutes(entry.segment)" class="mt-0.5 text-xs text-muted-foreground">
              then wait {{ waitMinutes(entry.segment) }} min
            </div>
            <div
              v-if="entry.segment.mode === 'rideshare' && entry.segment.rideshareDetails"
              class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground"
            >
              <span v-if="entry.segment.rideshareDetails.productName">{{ entry.segment.rideshareDetails.productName }}</span>
              <span v-if="entry.segment.rideshareDetails.priceRange" class="font-semibold text-foreground">
                ${{ entry.segment.rideshareDetails.priceRange.low.value.toFixed(0) }}–${{ entry.segment.rideshareDetails.priceRange.high.value.toFixed(0) }}
              </span>
              <span
                v-if="entry.segment.rideshareDetails.surgeMultiplier && entry.segment.rideshareDetails.surgeMultiplier > 1"
                class="text-amber-500 font-medium"
              >
                {{ entry.segment.rideshareDetails.surgeMultiplier.toFixed(1) }}× surge
              </span>
              <span v-if="entry.segment.rideshareDetails.pickupEta" class="inline-flex items-center gap-1">
                <ClockIcon class="size-3" />
                {{ Math.ceil(entry.segment.rideshareDetails.pickupEta / 60) }} min pickup
              </span>
              <a
                v-if="entry.segment.rideshareDetails.bookingUrl"
                :href="entry.segment.rideshareDetails.bookingUrl"
                target="_blank"
                class="text-primary hover:underline"
              >
                Book in {{ entry.segment.rideshareDetails.provider }} →
              </a>
            </div>
            <div
              v-if="entry.segment.sharedMobilityDetails"
              class="mt-2.5 rounded-xl bg-muted p-3 space-y-2"
            >
              <div class="flex items-center justify-between gap-3">
                <div class="min-w-0">
                  <div v-if="entry.segment.sharedMobilityDetails.stationName" class="text-[13px] font-medium truncate">
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
                  class="shrink-0 text-xs font-medium text-teal-700 dark:text-teal-300"
                >
                  {{ entry.segment.sharedMobilityDetails.availableVehicles }} available
                </div>
              </div>
              <div
                v-if="entry.segment.sharedMobilityDetails.pricing"
                class="flex items-baseline justify-between gap-2 border-t pt-2"
              >
                <span class="text-[13px] font-semibold">
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
                class="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-teal-600 px-3 text-[13px] font-medium text-white transition-colors hover:bg-teal-700"
              >
                Unlock in {{ entry.segment.sharedMobilityDetails.provider }}
                <ExternalLinkIcon class="size-3.5" />
              </a>
            </div>
          </LegCard>
        </template>
      </div>
    </div>
  </div>
</template>
