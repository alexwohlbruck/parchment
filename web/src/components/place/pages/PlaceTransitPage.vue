<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TransitDeparture, TransitStopInfo, WidgetResponse } from '@/types/place.types'
import { WidgetType } from '@/types/place.types'
import { ClockIcon, ExternalLinkIcon } from 'lucide-vue-next'
import RealtimeIndicator from '@/components/transit/RealtimeIndicator.vue'
import RouteBullet from '@/components/transit/RouteBullet.vue'
import { bulletFor, ensureBulletsAt } from '@/services/layers/features/portolan/portolan-bullets'
import ServiceAlerts from '@/components/transit/ServiceAlerts.vue'
import ServiceAlertBadge from '@/components/transit/ServiceAlertBadge.vue'
import { useTransitAlerts } from '@/composables/useTransitAlerts'
import { alertsFor, worstAlert } from '@/lib/transit-alerts'
import { api } from '@/lib/api'
import { useExternalLink } from '@/composables/useExternalLink'
import { useTransitClock } from '@/composables/useTransitClock'
import { groupDepartures, type BoardDeparture } from '@/lib/transit-departures'
import { transferLinesOf, type StationLine } from '@/composables/usePlaceTransitLines'
import StationTransfers from '@/components/transit/StationTransfers.vue'
import {
  formatDepartureTime,
  getMinutesUntil,
  getRouteBulletLabel,
} from '@/lib/transit'
import PanelLayout from '@/components/layouts/PanelLayout.vue'
import SheetPageHeader from '@/components/place/SheetPageHeader.vue'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'

/** Past this, a countdown stops being easier to read than a clock time. */
const COUNTDOWN_MAX_MINUTES = 120

/** Matches the server's expanded board window (24h). */
const EXPANDED_WINDOW_MINUTES = 1440

const props = defineProps<{
  transitInfo: TransitStopInfo
  /** Params the transit widget was fetched with — reused to reach further
   *  ahead when the rider asks for later departures. */
  widgetParams?: Record<string, string>
  /** When rendered inside a place tab: drop the page chrome (header/padding). */
  embedded?: boolean
}>()

const { t } = useI18n()
const { openExternalLink } = useExternalLink()
const router = useRouter()
const currentTime = useTransitClock()

/** Runs loaded on demand replace the widget's opening set. */
const laterDepartures = ref<TransitDeparture[] | null>(null)
const isLoadingMore = ref(false)

watch(
  () => props.transitInfo,
  () => { laterDepartures.value = null },
)

const departures = computed((): TransitDeparture[] => {
  return laterDepartures.value || props.transitInfo?.departures || []
})

/** Same curated bullets as the card this page expands. */
watch(
  () => [props.transitInfo?.lat, props.transitInfo?.lng],
  () => void ensureBulletsAt(props.transitInfo?.lat, props.transitInfo?.lng),
  { immediate: true },
)
const styleOfRoute = (route: { id: string; type?: number }) =>
  bulletFor(route.id, props.transitInfo?.lat, props.transitInfo?.lng, route.type)

/** Lines an in-station transfer reaches — listed below the board, since they
 *  do not depart from here. */
const transferLines = computed(() => transferLinesOf(props.transitInfo?.routes))

function openRoute(routeId?: string) {
  const feedId = props.transitInfo?.feedId
  if (!feedId || !routeId) return
  router.push({ name: AppRoute.TRANSIT_ROUTE, params: { feedId, routeId } })
}

/**
 * The connecting stations' own board, grouped exactly like this station's.
 *
 * Kept separate all the way from Barrelman: these runs leave another platform,
 * and merging them into the board above would say they depart from here.
 */
const transferGroups = computed(() =>
  groupDepartures(props.transitInfo?.transferDepartures || [], currentTime.value, {
    unknownDirectionLabel: t('place.transit.unknownDirection'),
    limit: 2,
    dayLabels: {
      tonight: t('place.transit.tonight'),
      tomorrow: t('place.transit.tomorrow'),
    },
  }),
)

const routeGroups = computed(() =>
  groupDepartures(departures.value, currentTime.value, {
    unknownDirectionLabel: t('place.transit.unknownDirection'),
    dayLabels: {
      tonight: t('place.transit.tonight'),
      tomorrow: t('place.transit.tomorrow'),
    },
  }),
)

// ── Service alerts ──────────────────────────────────────────
// One query covers the whole board: the stop itself plus every line calling
// at it, so each route heading can carry its own badge off a single fetch.

const alertQuery = computed(() => {
  const feedId = props.transitInfo?.feedId
  const stopId = props.transitInfo?.stopId
  if (!feedId || !stopId) return null
  return {
    feedId,
    stopIds: [stopId],
    routeIds: [...new Set(departures.value.map((d) => d.route?.id).filter(Boolean) as string[])],
    includeUpcoming: true,
  }
})

const { inEffect: stopAlerts } = useTransitAlerts(alertQuery)

/** The one alert a route heading's badge stands for, if any. */
function routeAlert(routeId: string) {
  return worstAlert(alertsFor(stopAlerts.value, { routeId }))
}

/** True when nothing on the board runs today — the stop is shut for the night
 *  and every run shown belongs to a later day. */
const isClosedForToday = computed(
  () =>
    routeGroups.value.length > 0 &&
    routeGroups.value.every((group) =>
      group.directions.every((dir) => dir.departures[0]?.dayLabel),
    ),
)

const canLoadMore = computed(
  () => Boolean(props.transitInfo?.hasMore) && !laterDepartures.value,
)

/** Refetch the same stops over a wider window. */
async function loadLaterDepartures() {
  if (isLoadingMore.value || !props.widgetParams) return
  isLoadingMore.value = true
  try {
    const response = await api.get<WidgetResponse<TransitStopInfo>>(
      `/places/widgets/${WidgetType.TRANSIT}`,
      { params: { ...props.widgetParams, window: String(EXPANDED_WINDOW_MINUTES) } },
    )
    laterDepartures.value = response.data.data.value?.departures || []
  } catch {
    // Leave the opening board in place — it's still valid, just shorter.
  } finally {
    isLoadingMore.value = false
  }
}

function formatMin(dep: BoardDeparture): string {
  const m = getMinutesUntil(dep, currentTime.value)
  if (m === null) return formatDepartureTime(dep)
  if (dep.dayLabel) return `${dep.dayLabel} ${formatDepartureTime(dep)}`
  if (m <= 0) return 'Now'
  if (m < 60) return `${m} min`
  if (m >= COUNTDOWN_MAX_MINUTES) return formatDepartureTime(dep)
  const h = Math.floor(m / 60)
  const r = m % 60
  return r > 0 ? `${h}h ${r}m` : `${h}h`
}

function openRouteDetail(departure: TransitDeparture) {
  const feedId = props.transitInfo?.feedId
  const routeId = departure.route.id
  if (!feedId || !routeId) return
  router.push({ name: AppRoute.TRANSIT_ROUTE, params: { feedId, routeId } })
}

function openTransitlandLink() {
  if (props.transitInfo?.onestopId) {
    openExternalLink(`https://www.transit.land/stops/${props.transitInfo.onestopId}`, '_blank')
  }
}
</script>

<template>
  <component :is="embedded ? 'div' : PanelLayout">
    <SheetPageHeader
      v-if="!embedded"
      :title="transitInfo?.name || t('place.transit.transitStop')"
    />

    <div v-if="transitInfo?.code" class="text-xs text-muted-foreground mb-3 -mt-1">
      Stop ID: {{ transitInfo.code }}
    </div>

    <!-- Service has finished for the day; everything below is a later day -->
    <div
      v-if="isClosedForToday"
      class="mb-4 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground"
    >
      {{ t('place.transit.noMoreToday') }}
    </div>

    <ServiceAlerts
      :query="alertQuery"
      :title="t('place.transit.alerts.atThisStop')"
      class="mb-4"
    />

    <div v-if="routeGroups.length > 0" class="space-y-5">
      <section v-for="group in routeGroups" :key="group.routeKey">
        <!-- Route badge + name -->
        <button
          class="flex items-center gap-2 mb-3 group cursor-pointer"
          @click="openRouteDetail(group.representative)"
        >
          <RouteBullet
            :label="styleOfRoute(group.route)?.label || getRouteBulletLabel(group.route, t)"
            :color="styleOfRoute(group.route)?.color || group.route.color"
            :shape="styleOfRoute(group.route)?.shape"
            :text-color="styleOfRoute(group.route)?.color ? null : group.route.textColor"
            class="group-hover:ring-2 ring-offset-1 ring-foreground/20 transition-shadow"
          />
          <span class="text-sm text-muted-foreground truncate group-hover:text-foreground transition-colors">
            {{ group.route.longName || group.route.shortName }}
          </span>
          <ServiceAlertBadge
            v-if="routeAlert(group.route.id)"
            :alert="routeAlert(group.route.id)!"
          />
        </button>

        <!-- Departure table: one row per direction -->
        <div class="space-y-2">
          <div
            v-for="dir in group.directions"
            :key="dir.headsign"
            class="grid gap-x-3 items-baseline"
            style="grid-template-columns: 1fr auto"
          >
            <!-- Row 1: headsign + next 2 countdowns -->
            <span class="text-sm truncate">{{ dir.headsign }}</span>
            <div class="flex items-center gap-1 justify-end">
              <template v-for="(dep, i) in dir.departures.slice(0, 2)" :key="i">
                <span v-if="i > 0" class="text-muted-foreground text-xs">,</span>
                <span
                  class="text-sm tabular-nums"
                  :class="{ 'text-green-600 dark:text-green-400 font-medium': i === 0 && getMinutesUntil(dep, currentTime) !== null && getMinutesUntil(dep, currentTime)! <= 1 }"
                >{{ formatMin(dep) }}</span>
                <RealtimeIndicator v-if="dep.realTime" :realTime="true" class="shrink-0" />
              </template>
            </div>

            <!-- Row 2: additional departure times (smaller, muted) -->
            <div
              v-if="dir.departures.length > 2"
              class="col-span-2 flex items-center gap-1 flex-wrap"
            >
              <template v-for="(dep, i) in dir.departures.slice(2, 8)" :key="i">
                <!-- Day boundary: the times that follow are on a later day -->
                <span
                  v-if="dep.dayLabel"
                  class="text-[10px] text-muted-foreground rounded bg-muted px-1.5 py-0.5"
                >{{ dep.dayLabel }}</span>
                <span v-else-if="i > 0" class="text-muted-foreground text-[10px]">,</span>
                <span class="text-xs tabular-nums text-muted-foreground">{{ formatDepartureTime(dep) }}</span>
                <RealtimeIndicator v-if="dep.realTime" :realTime="true" class="shrink-0" />
              </template>
              <span v-if="dir.departures.length > 8" class="text-xs text-muted-foreground">
                +{{ dir.departures.length - 8 }} more
              </span>
            </div>
          </div>
        </div>
      </section>

      <!-- The opening board covers a few hours; the rest of the day is a tap away -->
      <button
        v-if="canLoadMore && widgetParams"
        type="button"
        class="w-full rounded-md border py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-60"
        :disabled="isLoadingMore"
        @click="loadLaterDepartures"
      >
        {{ isLoadingMore ? t('place.transit.loadingMore') : t('place.transit.showLaterDepartures') }}
      </button>
    </div>

    <!-- No departures -->
    <div v-else class="text-center py-12 text-muted-foreground">
      <ClockIcon class="h-10 w-10 mx-auto mb-3 opacity-40" />
      <p class="text-sm">{{ t('place.transit.noUpcomingDepartures') }}</p>
      <p class="text-xs mt-1">{{ t('place.transit.checkBackLater') }}</p>
    </div>

    <StationTransfers
      :groups="transferGroups"
      :now="currentTime"
      :lines="transferLines"
      :lat="transitInfo?.lat"
      :lng="transitInfo?.lng"
      :feed-id="transitInfo?.feedId"
      class="mt-6"
      @open="(line: StationLine) => openRoute(line.id)"
      @open-route="(routeId: string) => openRoute(routeId)"
    />

    <!-- Footer -->
    <div class="mt-6 pt-3 border-t space-y-2 text-xs text-muted-foreground">
      <div v-if="departures.length > 0 && departures[0].agency">
        Operated by
        <a
          v-if="departures[0].agency?.url"
          :href="departures[0].agency.url"
          target="_blank"
          class="text-primary hover:underline"
        ><strong>{{ departures[0].agency.name }}</strong></a>
        <strong v-else>{{ departures[0].agency?.name }}</strong>
      </div>
      <button
        v-if="transitInfo?.onestopId"
        type="button"
        class="flex items-center gap-1 hover:text-foreground transition-colors"
        @click="openTransitlandLink"
      >
        <ExternalLinkIcon class="h-3 w-3" />
        View on Transitland
      </button>
    </div>
  </component>
</template>
