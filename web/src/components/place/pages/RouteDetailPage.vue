<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouteDetailStore } from '@/stores/route-detail.store'
import PanelLayout from '@/components/layouts/PanelLayout.vue'
import SheetPageHeader from '@/components/place/SheetPageHeader.vue'
import { Separator } from '@/components/ui/separator'
import {
  TrainFrontIcon,
  BusIcon,
  ShipIcon,
  TramFrontIcon,
  MapPinIcon,
} from 'lucide-vue-next'

const props = defineProps<{
  feedId: string
  routeId: string
}>()

const routeDetailStore = useRouteDetailStore()

const route = computed(() => routeDetailStore.activeRoute)
const isLoading = computed(() => routeDetailStore.isLoading)
const vehicles = computed(() => routeDetailStore.vehicleList)

const displayName = computed(() => {
  if (!route.value) return ''
  return route.value.routeShortName || route.value.routeLongName || route.value.routeId
})

const subtitle = computed(() => {
  if (!route.value) return ''
  if (route.value.routeShortName && route.value.routeLongName) {
    return route.value.routeLongName
  }
  return route.value.agencyName || ''
})

const bgColor = computed(() =>
  route.value?.routeColor ? `#${route.value.routeColor}` : 'hsl(var(--foreground))',
)

const textColor = computed(() =>
  route.value?.routeTextColor ? `#${route.value.routeTextColor}` : 'hsl(var(--background))',
)

const routeTypeIcon = computed(() => {
  switch (route.value?.routeType) {
    case 0: return TramFrontIcon
    case 1: return TrainFrontIcon
    case 2: return TrainFrontIcon
    case 3: return BusIcon
    case 4: return ShipIcon
    default: return BusIcon
  }
})

const routeTypeLabel = computed(() => {
  switch (route.value?.routeType) {
    case 0: return 'Tram'
    case 1: return 'Subway'
    case 2: return 'Rail'
    case 3: return 'Bus'
    case 4: return 'Ferry'
    default: return 'Transit'
  }
})

const relatedNames = computed(() => {
  if (!route.value?.relatedRouteIds?.length) return ''
  return route.value.relatedRouteIds.join(', ')
})

onMounted(() => {
  routeDetailStore.openRoute(props.feedId, props.routeId)
})

onUnmounted(() => {
  routeDetailStore.closeRoute()
})
</script>

<template>
  <PanelLayout>
    <SheetPageHeader :title="displayName || 'Route'" />

    <div v-if="isLoading" class="flex items-center justify-center py-12">
      <div class="animate-spin h-6 w-6 border-2 border-foreground/20 border-t-foreground rounded-full" />
    </div>

    <div v-else-if="route" class="flex flex-col gap-4 px-4 pb-6">
      <!-- Route header -->
      <div class="flex items-center gap-3">
        <div
          class="flex items-center justify-center min-w-10 h-10 px-2 rounded-lg font-bold text-lg"
          :style="{ background: bgColor, color: textColor }"
        >
          {{ route.routeShortName || '' }}
        </div>
        <div class="flex flex-col min-w-0">
          <span class="font-semibold text-sm leading-tight truncate">
            {{ subtitle || displayName }}
          </span>
          <span class="text-xs text-muted-foreground">
            {{ routeTypeLabel }}
            <template v-if="relatedNames">
              · also {{ relatedNames }}
            </template>
          </span>
        </div>
      </div>

      <!-- Live vehicles count -->
      <div
        v-if="vehicles.length > 0"
        class="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50"
      >
        <component :is="routeTypeIcon" class="h-4 w-4 text-muted-foreground" />
        <span class="text-sm text-muted-foreground">
          {{ vehicles.length }} active {{ vehicles.length === 1 ? 'vehicle' : 'vehicles' }}
        </span>
      </div>

      <Separator />

      <!-- Stop list -->
      <div class="flex flex-col">
        <div class="text-xs font-medium text-muted-foreground mb-2">
          {{ route.stops.length }} stops
        </div>

        <div class="relative pl-6">
          <!-- Route color line -->
          <div
            class="absolute left-[11px] top-1 bottom-1 w-[3px] rounded-full"
            :style="{ background: bgColor }"
          />

          <div
            v-for="(stop, i) in route.stops"
            :key="stop.stopId"
            class="relative flex items-center py-1.5"
          >
            <!-- Stop dot -->
            <div
              class="absolute -left-[15px] w-[9px] h-[9px] rounded-full border-2 bg-background"
              :style="{ borderColor: bgColor }"
              :class="{
                'w-[11px] h-[11px] -left-[16px]': i === 0 || i === route.stops.length - 1,
              }"
            />

            <span
              class="text-sm leading-tight"
              :class="{
                'font-medium': i === 0 || i === route.stops.length - 1,
              }"
            >
              {{ stop.stopName }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="flex flex-col items-center justify-center py-12 text-muted-foreground">
      <MapPinIcon class="h-8 w-8 mb-2 opacity-50" />
      <span class="text-sm">Route not found</span>
    </div>
  </PanelLayout>
</template>
