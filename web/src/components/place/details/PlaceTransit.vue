<script setup lang="ts">
/**
 * Transit departures widget — Apple Maps style.
 *
 * Compact, scannable layout:
 *   Route badge + name
 *     Headsign     Now, 7 min  📶
 *     Headsign     12, 25 min  📶
 */
import { computed, markRaw } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Place, TransitDeparture, TransitStopInfo } from '@/types/place.types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ChevronRightIcon } from 'lucide-vue-next'
import RealtimeIndicator from '@/components/transit/RealtimeIndicator.vue'
import { useSheetPage } from '@/composables/useSheetPage'
import { useTransitClock } from '@/composables/useTransitClock'
import {
  getMinutesUntil,
  getRouteColor,
  getTextColor,
} from '@/lib/transit'
import PlaceTransitPage from '@/components/place/pages/PlaceTransitPage.vue'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'

const props = defineProps<{
  place?: Partial<Place>
  transitInfo?: TransitStopInfo
}>()

const { t } = useI18n()
const { pushPage } = useSheetPage()
const router = useRouter()
const currentTime = useTransitClock()

const transitInfo = computed((): TransitStopInfo | null => {
  return props.transitInfo || props.place?.transit?.value || null
})

const hasTransitData = computed(() => {
  return transitInfo.value && (transitInfo.value.onestopId || transitInfo.value.stopId || transitInfo.value.departures?.length)
})

const departures = computed((): TransitDeparture[] => {
  return transitInfo.value?.departures || []
})

/** Every line serving this station, across its whole transfer complex. */
const stationLines = computed(() => transitInfo.value?.routes || [])

// ── Group departures: route → direction → sorted upcoming list ──

interface DirectionGroup {
  headsign: string
  departures: TransitDeparture[]
  hasRealtime: boolean
}

interface RouteGroup {
  routeKey: string
  route: TransitDeparture['route']
  directions: DirectionGroup[]
  /** A representative departure for opening route detail. */
  representative: TransitDeparture
}

const routeGroups = computed((): RouteGroup[] => {
  if (!departures.value.length) return []

  const routeMap = new Map<string, {
    route: TransitDeparture['route']
    dirMap: Map<string, TransitDeparture[]>
    rep: TransitDeparture
  }>()

  for (const dep of departures.value) {
    const mins = getMinutesUntil(dep, currentTime.value)
    if (mins !== null && mins < -1) continue

    const routeKey = dep.route.shortName || dep.route.longName || dep.route.id
    const headsign = dep.headsign || dep.direction || t('place.transit.unknownDirection')

    if (!routeMap.has(routeKey)) {
      routeMap.set(routeKey, { route: dep.route, dirMap: new Map(), rep: dep })
    }
    const entry = routeMap.get(routeKey)!
    if (!entry.dirMap.has(headsign)) {
      entry.dirMap.set(headsign, [])
    }
    entry.dirMap.get(headsign)!.push(dep)
  }

  const groups: RouteGroup[] = []
  for (const [routeKey, entry] of routeMap) {
    const directions: DirectionGroup[] = []
    for (const [headsign, deps] of entry.dirMap) {
      const sorted = [...deps].sort((a, b) => {
        const ma = getMinutesUntil(a, currentTime.value)
        const mb = getMinutesUntil(b, currentTime.value)
        if (ma === null && mb === null) return 0
        if (ma === null) return 1
        if (mb === null) return -1
        return ma - mb
      })
      directions.push({
        headsign,
        departures: sorted.slice(0, 3),
        hasRealtime: sorted.some(d => d.realTime),
      })
    }
    groups.push({
      routeKey,
      route: entry.route,
      directions,
      representative: entry.rep,
    })
  }

  return groups
})

function formatCountdownShort(dep: TransitDeparture): string {
  const mins = getMinutesUntil(dep, currentTime.value)
  if (mins === null) return ''
  if (mins <= 0) return 'Now'
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function directionCountdowns(dir: DirectionGroup): string {
  return dir.departures
    .map(d => formatCountdownShort(d))
    .filter(Boolean)
    .join(', ')
}

const agencyName = computed(() => {
  const first = departures.value[0]
  return first?.agency?.name || null
})

function openFullTransit() {
  if (!transitInfo.value) return
  pushPage({
    name: 'transit',
    component: markRaw(PlaceTransitPage),
    props: { transitInfo: transitInfo.value },
    title: transitInfo.value.name || t('place.transit.transitStop'),
  })
}

function openRouteDetail(group: RouteGroup) {
  const feedId = transitInfo.value?.feedId
  const routeId = group.route.id
  if (!feedId || !routeId) return

  router.push({
    name: AppRoute.TRANSIT_ROUTE,
    params: { feedId, routeId },
  })
}
</script>

<template>
  <Card v-if="hasTransitData">
    <CardHeader class="p-3 pb-0">
      <button
        type="button"
        class="flex items-center justify-between gap-2 w-full text-left group"
        @click="openFullTransit"
      >
        <CardTitle class="text-base">
          {{ t('place.transit.departures') }}
        </CardTitle>
        <ChevronRightIcon class="w-4 h-4 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" />
      </button>

      <!-- Every line serving this station, across its whole transfer
           complex — not just the routes departing soon -->
      <div
        v-if="stationLines.length"
        class="mt-1.5 flex flex-wrap items-center gap-1"
      >
        <span
          v-for="line in stationLines"
          :key="line.id"
          class="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-[11px] font-semibold leading-none"
          :style="{
            background: getRouteColor({ color: line.color } as never),
            color: getTextColor({ color: line.color, textColor: line.textColor } as never),
          }"
          :title="line.longName || line.shortName"
        >
          {{ line.shortName || line.id }}
        </span>
      </div>
    </CardHeader>

    <CardContent class="p-3 pt-2">
      <div v-if="routeGroups.length > 0" class="space-y-4">
        <div
          v-for="group in routeGroups"
          :key="group.routeKey"
        >
          <!-- Route header (clickable → route detail) -->
          <button
            class="flex items-center gap-2 mb-2 group/route cursor-pointer"
            @click="openRouteDetail(group)"
          >
            <Badge
              :style="{
                backgroundColor: getRouteColor(group.route),
                color: getTextColor(group.route),
              }"
              class="text-xs font-semibold shrink-0 group-hover/route:ring-2 ring-offset-1 ring-foreground/20 transition-shadow"
            >
              {{ group.routeKey }}
            </Badge>
            <span class="text-sm text-muted-foreground truncate group-hover/route:text-foreground transition-colors">
              {{ group.route.longName || group.route.shortName }}
            </span>
          </button>

          <!-- Direction rows -->
          <div class="space-y-1.5 ml-1">
            <div
              v-for="dir in group.directions"
              :key="dir.headsign"
              class="flex items-center justify-between gap-3"
            >
              <span class="text-sm truncate min-w-0">
                {{ dir.headsign }}
              </span>
              <div class="flex items-center gap-0.5 shrink-0">
                <template v-for="(dep, i) in dir.departures" :key="i">
                  <span v-if="i > 0" class="text-muted-foreground text-xs">,</span>
                  <span class="text-sm tabular-nums">{{ formatCountdownShort(dep) }}</span>
                  <RealtimeIndicator
                    v-if="dep.realTime"
                    :real-time="true"
                    :delay="dep.delay"
                    class="shrink-0"
                  />
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- No departures -->
      <div v-else class="py-4 text-center text-sm text-muted-foreground">
        {{ t('place.transit.noUpcomingDepartures') }}
      </div>

      <!-- Agency attribution -->
      <div v-if="agencyName" class="mt-3 pt-2 border-t text-xs text-muted-foreground">
        Transit information provided by {{ agencyName }}
      </div>
    </CardContent>
  </Card>
</template>
