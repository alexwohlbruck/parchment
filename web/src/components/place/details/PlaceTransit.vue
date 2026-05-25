<script setup lang="ts">
import { computed, markRaw } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Place, TransitDeparture, TransitStopInfo } from '@/types/place.types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ClockIcon, NavigationIcon, ChevronRightIcon } from 'lucide-vue-next'
import { useSheetPage } from '@/composables/useSheetPage'
import { useTransitClock } from '@/composables/useTransitClock'
import {
  formatDepartureTime,
  formatCountdown,
  getMinutesUntil,
  getRouteColor,
  getTextColor,
  getRouteTypeIcon,
  getDepartureTimeStyle,
} from '@/lib/transit'
import PlaceTransitPage from '@/components/place/pages/PlaceTransitPage.vue'

const props = defineProps<{
  place?: Partial<Place>
  transitInfo?: TransitStopInfo
}>()

const { t } = useI18n()
const { pushPage } = useSheetPage()
const currentTime = useTransitClock()

const transitInfo = computed((): TransitStopInfo | null => {
  return props.transitInfo || props.place?.transit?.value || null
})

const hasTransitData = computed(() => {
  return transitInfo.value && transitInfo.value.onestopId
})

const departures = computed((): TransitDeparture[] => {
  return transitInfo.value?.departures || []
})

const groupedDepartures = computed(() => {
  if (!departures.value.length) return {}

  const groups: Record<string, Record<string, TransitDeparture[]>> = {}

  // Inline widget shows only upcoming — past departures are surfaced via the
  // full sub-page's "Show previous" toggle, not the compact card.
  for (const departure of departures.value) {
    const minutes = getMinutesUntil(departure, currentTime.value)
    if (minutes !== null && minutes < 0) continue

    const routeKey = `${departure.route.shortName || departure.route.longName || departure.route.id}`
    const direction = departure.direction || departure.headsign || t('place.transit.unknownDirection')

    if (!groups[routeKey]) groups[routeKey] = {}
    if (!groups[routeKey][direction]) groups[routeKey][direction] = []
    groups[routeKey][direction].push(departure)
  }

  // Sort by minutes-until-now (handles tomorrow's morning runs correctly,
  // unlike sorting by raw HH:mm:ss strings).
  Object.keys(groups).forEach(routeKey => {
    Object.keys(groups[routeKey]).forEach(direction => {
      groups[routeKey][direction].sort((a, b) => {
        const ma = getMinutesUntil(a, currentTime.value)
        const mb = getMinutesUntil(b, currentTime.value)
        if (ma === null && mb === null) return 0
        if (ma === null) return 1
        if (mb === null) return -1
        return ma - mb
      })
    })
  })

  return groups
})

function minutesUntil(dep: TransitDeparture): number | null {
  return getMinutesUntil(dep, currentTime.value)
}

function openFullTransit() {
  if (!transitInfo.value) return
  pushPage({
    name: 'transit',
    component: markRaw(PlaceTransitPage),
    props: { transitInfo: transitInfo.value },
    title: transitInfo.value.name || t('place.transit.transitStop'),
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
        <CardTitle class="flex items-center gap-2 text-lg min-w-0">
          <component
            :is="getRouteTypeIcon(departures[0]?.route.type)"
            class="h-5 w-5 shrink-0"
            :style="departures.length > 0 ? { color: getRouteColor(departures[0].route) } : {}"
          />
          <span class="truncate">{{ transitInfo?.name || t('place.transit.transitStop') }}</span>
        </CardTitle>
        <ChevronRightIcon class="w-4 h-4 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" />
      </button>
      <div v-if="transitInfo?.code" class="text-sm text-muted-foreground">
        Stop ID: {{ transitInfo.code }}
      </div>
    </CardHeader>

    <CardContent class="p-3 space-y-4">
      <!-- Departures Section -->
      <div v-if="Object.keys(groupedDepartures).length > 0">
        <h4 class="text-sm font-semibold mb-3 flex items-center gap-2">
          <ClockIcon class="h-4 w-4" />
          {{ t('place.transit.upcomingDepartures') }}
        </h4>

        <div class="space-y-4">
          <div
            v-for="(directions, routeKey) in groupedDepartures"
            :key="routeKey"
            class="space-y-2"
          >
            <!-- Route Header -->
            <div class="flex items-center gap-2">
              <Badge
                :style="{
                  backgroundColor: getRouteColor(Object.values(directions)[0][0].route),
                  color: getTextColor(Object.values(directions)[0][0].route),
                }"
                class="text-xs font-semibold"
              >
                {{ routeKey }}
              </Badge>
              <span class="text-sm text-muted-foreground">
                {{ Object.values(directions)[0][0].route.longName }}
              </span>
            </div>

            <!-- Directions -->
            <div
              class="space-y-2 ml-2 pl-3 border-l-2"
              :style="{ borderLeftColor: getRouteColor(Object.values(directions)[0][0].route) }"
            >
              <div
                v-for="(departureList, direction) in directions"
                :key="`${routeKey}-${direction}`"
                class="space-y-1"
              >
                <div class="flex items-center gap-2 text-sm">
                  <NavigationIcon
                    class="h-3 w-3"
                    :style="{ color: getRouteColor(departureList[0].route) }"
                  />
                  <span class="font-medium">{{ direction }}</span>
                </div>

                <div class="flex flex-wrap gap-2 ml-5">
                  <div
                    v-for="(departure, index) in departureList.slice(0, 4)"
                    :key="`${routeKey}-${direction}-${index}`"
                    class="flex items-center gap-1 text-xs"
                  >
                    <Badge
                      variant="outline"
                      class="font-mono border-1"
                      :style="getDepartureTimeStyle(minutesUntil(departure))"
                    >
                      {{ formatDepartureTime(departure) }}
                    </Badge>
                    <span
                      v-if="minutesUntil(departure) !== null"
                      class="text-muted-foreground text-xs"
                    >
                      {{ formatCountdown(minutesUntil(departure), t) }}
                    </span>
                    <span
                      v-if="departure.realTime"
                      class="text-xs font-medium"
                      :style="{ color: getRouteColor(departure.route) }"
                      :title="t('place.transit.realTimeData')"
                    >
                      {{ t('place.transit.live') }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- No Departures -->
      <div v-else class="text-center py-6 text-muted-foreground">
        <ClockIcon class="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p class="text-sm">{{ t('place.transit.noUpcomingDepartures') }}</p>
        <p class="text-xs mt-1">{{ t('place.transit.checkBackLater') }}</p>
      </div>
    </CardContent>
  </Card>
</template>
