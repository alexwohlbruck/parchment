<script setup lang="ts">
import { computed, ref, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TransitDeparture, TransitStopInfo } from '@/types/place.types'
import { Badge } from '@/components/ui/badge'
import { ClockIcon, NavigationIcon, ExternalLinkIcon } from 'lucide-vue-next'
import { useExternalLink } from '@/composables/useExternalLink'
import { useTransitClock } from '@/composables/useTransitClock'
import {
  formatDepartureTime,
  formatCountdown,
  getMinutesUntil,
  getCountdownClass,
  getRouteColor,
  getTextColor,
} from '@/lib/transit'
import PanelLayout from '@/components/layouts/PanelLayout.vue'
import SheetPageHeader from '@/components/place/SheetPageHeader.vue'

const props = defineProps<{
  transitInfo: TransitStopInfo
}>()

const { t } = useI18n()
const { openExternalLink } = useExternalLink()
const currentTime = useTransitClock()

const departures = computed((): TransitDeparture[] => {
  return props.transitInfo?.departures || []
})

interface DirectionView {
  past: TransitDeparture[]
  upcoming: TransitDeparture[]
}

interface RouteView {
  /** Direction → past + upcoming partition. */
  directions: Record<string, DirectionView>
  /** Order to render directions in (preserved from first-seen). */
  directionOrder: string[]
}

const groupedDepartures = computed<Record<string, RouteView>>(() => {
  if (!departures.value.length) return {}

  // First pass: bucket by route → direction → ordered list.
  const buckets: Record<string, Record<string, TransitDeparture[]>> = {}
  const directionOrders: Record<string, string[]> = {}

  departures.value.forEach(departure => {
    const routeKey = `${departure.route.shortName || departure.route.longName || departure.route.id}`
    const direction = departure.direction || departure.headsign || t('place.transit.unknownDirection')

    if (!buckets[routeKey]) {
      buckets[routeKey] = {}
      directionOrders[routeKey] = []
    }
    if (!buckets[routeKey][direction]) {
      buckets[routeKey][direction] = []
      directionOrders[routeKey].push(direction)
    }
    buckets[routeKey][direction].push(departure)
  })

  // Second pass: sort each direction by minutes-until-now (ascending — past
  // first, then closest upcoming) and split into past / upcoming.
  const result: Record<string, RouteView> = {}
  for (const routeKey of Object.keys(buckets)) {
    const directionMap: Record<string, DirectionView> = {}
    for (const direction of directionOrders[routeKey]) {
      const sorted = [...buckets[routeKey][direction]].sort((a, b) => {
        const ma = minutesUntil(a)
        const mb = minutesUntil(b)
        if (ma === null && mb === null) return 0
        if (ma === null) return 1
        if (mb === null) return -1
        return ma - mb
      })
      const past: TransitDeparture[] = []
      const upcoming: TransitDeparture[] = []
      for (const dep of sorted) {
        const m = minutesUntil(dep)
        if (m !== null && m < 0) past.push(dep)
        else upcoming.push(dep)
      }
      directionMap[direction] = { past, upcoming }
    }
    result[routeKey] = {
      directions: directionMap,
      directionOrder: directionOrders[routeKey],
    }
  }

  return result
})

const hasDepartures = computed(() => Object.keys(groupedDepartures.value).length > 0)

// Default upcoming visible count per direction. Tuned to fit on a phone
// viewport without forcing scroll past the next direction header.
const DEFAULT_VISIBLE = 5

// Per-direction toggle state for upcoming overflow ("Show more") and past
// list ("Show previous"). Independent so the user can expand only what they
// want.
const upcomingExpanded = ref(new Set<string>())
const previousExpanded = ref(new Set<string>())

function directionKey(routeKey: string, direction: string): string {
  return `${routeKey}::${direction}`
}

function toggle(set: Ref<Set<string>>, key: string) {
  const next = new Set(set.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  set.value = next
}

function isUpcomingExpanded(routeKey: string, direction: string): boolean {
  return upcomingExpanded.value.has(directionKey(routeKey, direction))
}
function toggleUpcoming(routeKey: string, direction: string) {
  toggle(upcomingExpanded, directionKey(routeKey, direction))
}

function isPreviousExpanded(routeKey: string, direction: string): boolean {
  return previousExpanded.value.has(directionKey(routeKey, direction))
}
function togglePrevious(routeKey: string, direction: string) {
  toggle(previousExpanded, directionKey(routeKey, direction))
}

function visibleUpcoming(
  list: TransitDeparture[],
  routeKey: string,
  direction: string,
): TransitDeparture[] {
  if (isUpcomingExpanded(routeKey, direction)) return list
  return list.slice(0, DEFAULT_VISIBLE)
}

function minutesUntil(dep: TransitDeparture): number | null {
  return getMinutesUntil(dep, currentTime.value)
}

/**
 * Pick a representative departure from a `DirectionView` to read route
 * metadata off (color, longName) — needed because the route info lives on
 * each departure. Prefers upcoming over past since past entries are more
 * likely to be missing real-time updates.
 */
function repDeparture(view: DirectionView): TransitDeparture {
  return view.upcoming[0] ?? view.past[0]
}

/** Same idea at the route level — picks from the first direction. */
function repForRoute(view: RouteView): TransitDeparture {
  return repDeparture(view.directions[view.directionOrder[0]])
}

function openTransitlandLink() {
  if (props.transitInfo?.onestopId) {
    openExternalLink(`https://www.transit.land/stops/${props.transitInfo.onestopId}`, '_blank')
  }
}
</script>

<template>
  <PanelLayout>
    <SheetPageHeader :title="transitInfo?.name || t('place.transit.transitStop')" />

    <div v-if="transitInfo?.code" class="text-xs text-muted-foreground mb-4 -mt-1">
      Stop ID: {{ transitInfo.code }}
    </div>

    <!-- Departures: grouped by route, each direction is a vertical list -->
    <div v-if="hasDepartures" class="space-y-6">
      <section
        v-for="(routeView, routeKey) in groupedDepartures"
        :key="routeKey"
      >
        <!-- Route header -->
        <div class="flex items-center gap-2 mb-3">
          <Badge
            :style="{
              backgroundColor: getRouteColor(repForRoute(routeView).route),
              color: getTextColor(repForRoute(routeView).route),
            }"
            class="text-xs font-semibold"
          >
            {{ routeKey }}
          </Badge>
          <span class="text-sm text-muted-foreground truncate">
            {{ repForRoute(routeView).route.longName }}
          </span>
        </div>

        <!-- One sub-section per direction -->
        <div class="space-y-4">
          <div
            v-for="direction in routeView.directionOrder"
            :key="`${routeKey}-${direction}`"
          >
            <div class="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
              <NavigationIcon
                class="h-3 w-3"
                :style="{
                  color: getRouteColor(repDeparture(routeView.directions[direction]).route),
                }"
              />
              <span class="font-semibold">{{ direction }}</span>
            </div>

            <!-- "Show previous" toggle: rendered ABOVE the list so previous
                 departures appear in chronological order when expanded. -->
            <button
              v-if="routeView.directions[direction].past.length > 0"
              type="button"
              class="ml-1.5 pl-3 mb-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              @click="togglePrevious(String(routeKey), String(direction))"
            >
              <template v-if="isPreviousExpanded(String(routeKey), String(direction))">
                Hide previous
              </template>
              <template v-else>
                Show {{ routeView.directions[direction].past.length }} previous
              </template>
            </button>

            <ul
              class="border-l-2 ml-1.5"
              :style="{
                borderLeftColor: getRouteColor(repDeparture(routeView.directions[direction]).route),
              }"
            >
              <!-- Past departures (only when expanded) — rendered above
                   upcoming so the list reads chronologically top-to-bottom. -->
              <template v-if="isPreviousExpanded(String(routeKey), String(direction))">
                <li
                  v-for="(departure, i) in routeView.directions[direction].past"
                  :key="`${routeKey}-${direction}-past-${i}`"
                  class="flex items-baseline gap-3 pl-3 py-2 border-b border-border/50 opacity-60"
                >
                  <span class="font-mono text-base font-semibold tabular-nums w-14">
                    {{ formatDepartureTime(departure) }}
                  </span>
                  <span
                    class="text-sm tabular-nums"
                    :class="getCountdownClass(minutesUntil(departure))"
                  >
                    {{ formatCountdown(minutesUntil(departure), t) }}
                  </span>
                </li>
              </template>

              <!-- Upcoming departures (truncated to 5 by default) -->
              <li
                v-for="(departure, i) in visibleUpcoming(
                  routeView.directions[direction].upcoming,
                  String(routeKey),
                  String(direction),
                )"
                :key="`${routeKey}-${direction}-up-${i}`"
                class="flex items-baseline gap-3 pl-3 py-2 border-b border-border/50 last:border-b-0"
              >
                <span class="font-mono text-base font-semibold tabular-nums w-14">
                  {{ formatDepartureTime(departure) }}
                </span>
                <span
                  class="text-sm tabular-nums"
                  :class="getCountdownClass(minutesUntil(departure))"
                >
                  {{ formatCountdown(minutesUntil(departure), t) }}
                </span>
                <span
                  v-if="departure.realTime"
                  class="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide"
                  :style="{ color: getRouteColor(departure.route) }"
                  :title="t('place.transit.realTimeData')"
                >
                  <span
                    class="h-1.5 w-1.5 rounded-full animate-pulse"
                    :style="{ backgroundColor: getRouteColor(departure.route) }"
                  />
                  {{ t('place.transit.live') }}
                </span>
              </li>
            </ul>

            <!-- "Show more" toggle for upcoming overflow -->
            <button
              v-if="routeView.directions[direction].upcoming.length > DEFAULT_VISIBLE"
              type="button"
              class="ml-1.5 pl-3 mt-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              @click="toggleUpcoming(String(routeKey), String(direction))"
            >
              <template v-if="isUpcomingExpanded(String(routeKey), String(direction))">
                Show less
              </template>
              <template v-else>
                Show {{ routeView.directions[direction].upcoming.length - DEFAULT_VISIBLE }} more
              </template>
            </button>
          </div>
        </div>
      </section>
    </div>

    <!-- No departures -->
    <div v-else class="text-center py-12 text-muted-foreground">
      <ClockIcon class="h-10 w-10 mx-auto mb-3 opacity-40" />
      <p class="text-sm">{{ t('place.transit.noUpcomingDepartures') }}</p>
      <p class="text-xs mt-1">{{ t('place.transit.checkBackLater') }}</p>
    </div>

    <!-- Footer: agency + Transitland -->
    <div class="mt-6 pt-3 border-t space-y-2 text-xs text-muted-foreground">
      <div v-if="departures.length > 0 && departures[0].agency">
        Operated by
        <a
          v-if="departures[0].agency?.url"
          :href="departures[0].agency.url"
          target="_blank"
          class="text-primary hover:underline"
        >{{ departures[0].agency.name }}</a>
        <span v-else class="text-foreground">{{ departures[0].agency.name }}</span>
      </div>
      <button
        v-if="transitInfo?.onestopId"
        @click="openTransitlandLink"
        class="hover:text-foreground transition-colors flex items-center gap-1"
      >
        <ExternalLinkIcon class="h-3 w-3" />
        View on Transitland
      </button>
    </div>
  </PanelLayout>
</template>
