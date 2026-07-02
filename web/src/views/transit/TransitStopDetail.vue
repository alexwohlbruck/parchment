<script setup lang="ts">
/**
 * Transit stop / station detail view — the proprietary destination for
 * transit map clicks (bus stop circles, rail station markers). Data comes
 * from Parchment's own backend (Barrelman GTFS + MOTIS via the transit
 * widget endpoint) — no third-party place providers.
 *
 * Two id spaces, one page:
 *   - /transit/stop/:feedId/:stopId — GTFS-keyed (bus stop tiles carry
 *     feed_id + stop_id). Barrelman queries the stop directly; no
 *     coordinates required, so deep links work.
 *   - /transit/station/:lat/:lng — station complexes. The clustered
 *     transit_stations markers carry no GTFS ids, so the label point is the
 *     key; Barrelman aggregates departures from the platform stops within
 *     STATION_RADIUS_M of it.
 *
 * `?name=` carries the clicked label for an instant header while loading.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ArrowLeftIcon, MapPinIcon } from 'lucide-vue-next'
import { api } from '@/lib/api'
import {
  WidgetType,
  type TransitStopInfo,
  type WidgetResponse,
} from '@/types/place.types'
import { AppRoute } from '@/router'
import PanelLayout from '@/components/layouts/PanelLayout.vue'
import RouteBullet from '@/components/transit/RouteBullet.vue'
import TransitDepartureBoard from '@/components/transit/TransitDepartureBoard.vue'

/** Search radius (m) around a station label point. Station complexes cluster
 *  same-named nodes within ~330 m, so the centroid can sit well away from the
 *  platforms; Barrelman's default 150 m misses the far ones. */
const STATION_RADIUS_M = 250

const route = useRoute()
const router = useRouter()
const { t } = useI18n()

const transitInfo = ref<TransitStopInfo | null>(null)
const loading = ref(false)
const failed = ref(false)

const title = computed(() => {
  const queryName = route.query.name
  if (typeof queryName === 'string' && queryName) return queryName
  return transitInfo.value?.name || t('place.transit.transitStop')
})

/** Full badge row of lines serving the stop/station (transfer-complex wide). */
const stationRoutes = computed(() => transitInfo.value?.routes || [])

/** The widget query for the current route params, or null off-route. */
const widgetParams = computed((): Record<string, string> | null => {
  const { feedId, stopId, lat, lng } = route.params
  if (typeof feedId === 'string' && typeof stopId === 'string') {
    return { feedId, stopId }
  }
  if (typeof lat === 'string' && typeof lng === 'string') {
    return { lat, lng, radius: String(STATION_RADIUS_M) }
  }
  return null
})

let loadSeq = 0
async function load() {
  const params = widgetParams.value
  if (!params) return
  const seq = ++loadSeq
  loading.value = true
  failed.value = false
  try {
    const response = await api.get<WidgetResponse<TransitStopInfo>>(
      `/places/widgets/${WidgetType.TRANSIT}`,
      { params },
    )
    if (seq !== loadSeq) return
    transitInfo.value = (response.data.data.value as TransitStopInfo) ?? null
  } catch {
    if (seq !== loadSeq) return
    failed.value = true
    transitInfo.value = null
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

onMounted(load)
// Refetch when navigating stop → stop (the component instance is reused).
watch(widgetParams, (next, prev) => {
  if (JSON.stringify(next) !== JSON.stringify(prev)) load()
})

function openRoute(routeEntry: { id: string }) {
  const feedId = transitInfo.value?.feedId
  if (!feedId || !routeEntry.id) return
  router.push({
    name: AppRoute.TRANSIT_ROUTE,
    params: { feedId, routeId: routeEntry.id },
  })
}
</script>

<template>
  <PanelLayout>
    <!-- Header -->
    <div class="flex items-center gap-2 mb-3">
      <button class="p-1 -ml-1 rounded-md hover:bg-muted" @click="router.back()">
        <ArrowLeftIcon class="h-4 w-4" />
      </button>
      <h2 class="text-base font-semibold truncate">{{ title }}</h2>
    </div>

    <!-- Lines serving this stop/station (aggregated across the complex) -->
    <div v-if="stationRoutes.length > 0" class="flex flex-wrap gap-1 mb-4">
      <button
        v-for="r in stationRoutes"
        :key="r.id"
        type="button"
        class="cursor-pointer"
        @click="openRoute(r)"
      >
        <RouteBullet
          :label="r.shortName || r.id"
          :color="r.color"
          :text-color="r.textColor"
          class="hover:ring-2 ring-offset-1 ring-foreground/20 transition-shadow"
        />
      </button>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-12">
      <div class="animate-spin h-6 w-6 border-2 border-foreground/20 border-t-foreground rounded-full" />
    </div>

    <TransitDepartureBoard v-else-if="transitInfo" :transit-info="transitInfo" />

    <div v-else class="flex flex-col items-center justify-center py-12 text-muted-foreground">
      <MapPinIcon class="h-8 w-8 mb-2 opacity-50" />
      <span class="text-sm">{{ failed ? t('place.transit.checkBackLater') : t('place.transit.noUpcomingDepartures') }}</span>
    </div>
  </PanelLayout>
</template>
