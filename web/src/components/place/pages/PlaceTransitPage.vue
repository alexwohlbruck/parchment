<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TransitDeparture, TransitStopInfo } from '@/types/place.types'
import { Badge } from '@/components/ui/badge'
import { ClockIcon, ExternalLinkIcon } from 'lucide-vue-next'
import RealtimeIndicator from '@/components/transit/RealtimeIndicator.vue'
import { useExternalLink } from '@/composables/useExternalLink'
import { useTransitClock } from '@/composables/useTransitClock'
import {
  formatDepartureTime,
  getMinutesUntil,
  getRouteColor,
  getTextColor,
} from '@/lib/transit'
import PanelLayout from '@/components/layouts/PanelLayout.vue'
import SheetPageHeader from '@/components/place/SheetPageHeader.vue'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'

const props = defineProps<{
  transitInfo: TransitStopInfo
}>()

const { t } = useI18n()
const { openExternalLink } = useExternalLink()
const router = useRouter()
const currentTime = useTransitClock()

const departures = computed((): TransitDeparture[] => {
  return props.transitInfo?.departures || []
})

interface DirectionGroup {
  headsign: string
  upcoming: TransitDeparture[]
}

interface RouteGroup {
  routeKey: string
  route: TransitDeparture['route']
  directions: DirectionGroup[]
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
    if (!entry.dirMap.has(headsign)) entry.dirMap.set(headsign, [])
    entry.dirMap.get(headsign)!.push(dep)
  }

  const groups: RouteGroup[] = []
  for (const [routeKey, entry] of routeMap) {
    const directions: DirectionGroup[] = []
    for (const [headsign, deps] of entry.dirMap) {
      const sorted = [...deps].sort((a, b) => {
        const ma = getMinutesUntil(a, currentTime.value)
        const mb = getMinutesUntil(b, currentTime.value)
        return (ma ?? 9999) - (mb ?? 9999)
      })
      directions.push({ headsign, upcoming: sorted })
    }
    groups.push({ routeKey, route: entry.route, directions, representative: entry.rep })
  }
  return groups
})

function formatMin(dep: TransitDeparture): string {
  const m = getMinutesUntil(dep, currentTime.value)
  if (m === null) return formatDepartureTime(dep)
  if (m <= 0) return 'Now'
  if (m < 60) return `${m} min`
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
  <PanelLayout>
    <SheetPageHeader :title="transitInfo?.name || t('place.transit.transitStop')" />

    <div v-if="transitInfo?.code" class="text-xs text-muted-foreground mb-3 -mt-1">
      Stop ID: {{ transitInfo.code }}
    </div>

    <div v-if="routeGroups.length > 0" class="space-y-5">
      <section v-for="group in routeGroups" :key="group.routeKey">
        <!-- Route badge + name -->
        <button
          class="flex items-center gap-2 mb-3 group cursor-pointer"
          @click="openRouteDetail(group.representative)"
        >
          <Badge
            :style="{
              backgroundColor: getRouteColor(group.route),
              color: getTextColor(group.route),
            }"
            class="text-xs font-semibold shrink-0 group-hover:ring-2 ring-offset-1 ring-foreground/20 transition-shadow"
          >
            {{ group.routeKey }}
          </Badge>
          <span class="text-sm text-muted-foreground truncate group-hover:text-foreground transition-colors">
            {{ group.route.longName || group.route.shortName }}
          </span>
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
              <template v-for="(dep, i) in dir.upcoming.slice(0, 2)" :key="i">
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
              v-if="dir.upcoming.length > 2"
              class="col-span-2 flex items-center gap-1 flex-wrap"
            >
              <template v-for="(dep, i) in dir.upcoming.slice(2, 8)" :key="i">
                <span v-if="i > 0" class="text-muted-foreground text-[10px]">,</span>
                <span class="text-xs tabular-nums text-muted-foreground">{{ formatDepartureTime(dep) }}</span>
                <RealtimeIndicator v-if="dep.realTime" :realTime="true" class="shrink-0" />
              </template>
              <span v-if="dir.upcoming.length > 8" class="text-xs text-muted-foreground">
                +{{ dir.upcoming.length - 8 }} more
              </span>
            </div>
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
  </PanelLayout>
</template>
