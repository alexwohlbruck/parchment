<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  FootprintsIcon,
  BikeIcon,
  CarFrontIcon,
  ArrowLeftIcon,
  PencilIcon,
  Share2Icon,
  Trash2Icon,
  NavigationIcon,
  ClockIcon,
  ArrowUpRightIcon,
  ArrowDownRightIcon,
  LockIcon,
} from 'lucide-vue-next'
import PanelLayout from '@/components/layouts/PanelLayout.vue'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip'
import ElevationChart from '@/components/directions/ElevationChart.vue'
import { useRoutesService } from '@/services/library/routes.service'
import { useRouteBuilderStore } from '@/stores/route-builder.store'
import { useRouteBuilderService } from '@/services/route-builder.service'
import { useMapService } from '@/services/map.service'
import { useUnits } from '@/composables/useUnits'
import { AppRoute } from '@/router'
import type { Route } from '@/types/routes.types'

const props = defineProps<{ id: string }>()

const router = useRouter()
const routesService = useRoutesService()
const builderStore = useRouteBuilderStore()
const builder = useRouteBuilderService()
const mapService = useMapService()
const { formatDistance, formatElevation } = useUnits()

const route = ref<Route | null>(null)
const loading = ref(true)

const modeIcon = computed(
  () =>
    ({
      walking: FootprintsIcon,
      cycling: BikeIcon,
      driving: CarFrontIcon,
    })[route.value?.mode ?? 'walking'] ?? FootprintsIcon,
)

const stats = computed(
  () => route.value?.body?.stats ?? {
    distance: route.value?.distance ?? 0,
    duration: route.value?.duration ?? 0,
    elevationGain: route.value?.elevationGain ?? undefined,
    elevationLoss: route.value?.elevationLoss ?? undefined,
  },
)

const chartGeometry = computed(() => {
  const body = route.value?.body
  if (!body?.geometry) return []
  return body.geometry.map(([lng, lat], i) => ({
    lng,
    lat,
    elevation: body.elevation?.[i],
  }))
})
const hasElevation = computed(() => !!route.value?.body?.elevation?.length)
const isPrivate = computed(() => route.value?.scheme === 'user-e2ee')

function formatDuration(seconds: number): string {
  const m = Math.round(seconds / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem ? `${h} hr ${rem} min` : `${h} hr`
}

function frameRoute() {
  const geom = route.value?.body?.geometry
  if (!geom || geom.length < 2) return
  let minLat = Infinity,
    minLng = Infinity,
    maxLat = -Infinity,
    maxLng = -Infinity
  for (const [lng, lat] of geom) {
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
  }
  mapService.fitBounds({ minLat, minLng, maxLat, maxLng })
}

onMounted(async () => {
  loading.value = true
  const r = await routesService.fetchRouteById(props.id)
  route.value = r
  loading.value = false
  if (r?.body?.geometry?.length) {
    builderStore.preview({
      mode: r.mode,
      scheme: r.scheme,
      waypoints: r.body.waypoints ?? [],
      geometry: r.body.geometry,
      elevation: r.body.elevation,
      segments: r.body.segments,
      stats: r.body.stats ?? null,
    })
    frameRoute()
  }
})

onUnmounted(() => {
  builderStore.reset()
})

function back() {
  router.push({ name: AppRoute.LIBRARY_ROUTES })
}

function edit() {
  router.push({ name: 'route-builder-edit', params: { id: props.id } })
}

function goToDirections() {
  if (builder.toDirections()) {
    router.push({ name: AppRoute.DIRECTIONS })
  }
}

async function share() {
  const url = await routesService.createShareLink(props.id)
  if (url) {
    await navigator.clipboard.writeText(url).catch(() => {})
  }
}

async function remove() {
  const ok = await routesService.deleteRoute(props.id)
  if (ok) back()
}
</script>

<template>
  <PanelLayout>
    <div v-if="loading" class="flex items-center justify-center py-20">
      <Spinner />
    </div>

    <template v-else-if="route">
      <div class="flex items-center gap-2 mb-3">
        <Button variant="ghost" size="icon" @click="back">
          <ArrowLeftIcon class="size-4" />
        </Button>
        <component :is="modeIcon" class="size-5 text-cobalt-600" />
        <h1 class="text-xl font-semibold truncate flex-1">
          {{ routesService.getRouteDisplayName(route) }}
        </h1>
        <LockIcon v-if="isPrivate" class="size-4 text-muted-foreground" />
      </div>

      <p
        v-if="route.description"
        class="text-sm text-muted-foreground mb-3"
      >
        {{ route.description }}
      </p>

      <!-- Stats -->
      <div class="rounded-lg border p-3 mb-3">
        <div class="flex items-baseline gap-3 flex-wrap">
          <span class="text-2xl font-semibold">
            {{ formatDistance(stats.distance) }}
          </span>
          <span
            class="inline-flex items-center gap-1 text-sm text-muted-foreground"
          >
            <ClockIcon class="size-3.5" />
            {{ formatDuration(stats.duration) }}
          </span>
          <span
            v-if="stats.elevationGain"
            class="inline-flex items-center gap-0.5 text-sm text-muted-foreground"
          >
            <ArrowUpRightIcon class="size-3.5" />
            {{ formatElevation(stats.elevationGain) }}
          </span>
          <span
            v-if="stats.elevationLoss"
            class="inline-flex items-center gap-0.5 text-sm text-muted-foreground"
          >
            <ArrowDownRightIcon class="size-3.5" />
            {{ formatElevation(stats.elevationLoss) }}
          </span>
        </div>
        <div v-if="hasElevation" class="mt-3">
          <ElevationChart
            :segment-index="0"
            :geometry="chartGeometry"
            :mode="route.mode"
            :total-elevation-gain="stats.elevationGain"
            :total-elevation-loss="stats.elevationLoss"
          />
        </div>
      </div>

      <!-- Primary actions -->
      <div class="flex gap-2 mb-2">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button class="flex-1" disabled>
                <NavigationIcon class="size-4" /> Start
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Turn-by-turn navigation is coming soon
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <Button variant="outline" class="flex-1" @click="goToDirections">
          Directions
        </Button>
      </div>

      <!-- Secondary actions -->
      <div class="flex gap-2">
        <Button variant="ghost" size="sm" class="gap-1.5" @click="edit">
          <PencilIcon class="size-4" /> Edit
        </Button>
        <Button
          v-if="!isPrivate"
          variant="ghost"
          size="sm"
          class="gap-1.5"
          @click="share"
        >
          <Share2Icon class="size-4" /> Share
        </Button>
        <div class="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          class="gap-1.5 text-destructive"
          @click="remove"
        >
          <Trash2Icon class="size-4" /> Delete
        </Button>
      </div>
    </template>

    <div v-else class="text-center text-muted-foreground py-20">
      Route not found
    </div>
  </PanelLayout>
</template>
