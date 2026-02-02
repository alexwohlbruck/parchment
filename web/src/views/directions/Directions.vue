<script setup lang="ts">
import dayjs from 'dayjs'
import duration from 'dayjs/plugin/duration'
import { onUnmounted } from 'vue'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useDirectionsService } from '@/services/directions.service'
import { useMapListener } from '@/composables/useMapListener'
import {
  BikeIcon,
  BusFrontIcon,
  CarFrontIcon,
  FootprintsIcon,
  ShuffleIcon,
  SlidersHorizontalIcon,
  TrainFrontIcon,
  TrainIcon,
} from 'lucide-vue-next'
import { useDirectionsStore } from '@/stores/directions.store'
import { storeToRefs } from 'pinia'
import WaypointInput from './WaypointInput.vue'
import TripsList from './TripsList.vue'
import RoutingPreferences from './RoutingPreferences.vue'
import { Spinner } from '@/components/ui/spinner'
import { Waypoint } from '@/types/map.types'
import { SelectedMode } from '@/types/multimodal.types'
import PanelLayout from '@/components/layouts/PanelLayout.vue'
import { Button } from '@/components/ui/button'
import ResponsivePopover from '@/components/responsive/ResponsivePopover.vue'
import { ref } from 'vue'

dayjs.extend(duration)

const directionsService = useDirectionsService()
const directionsStore = useDirectionsStore()

const { waypoints, trips, selectedMode, isLoading, routingPreferences } =
  storeToRefs(directionsStore)

const showPreferences = ref(false)

const modes: Array<{ type: SelectedMode; icon: any; label: string }> = [
  {
    type: 'multi',
    icon: ShuffleIcon,
    label: 'All modes',
  },
  {
    type: 'walking',
    icon: FootprintsIcon,
    label: 'Walking',
  },
  {
    type: 'biking',
    icon: BikeIcon,
    label: 'Cycling',
  },
  {
    type: 'transit',
    icon: TrainIcon,
    label: 'Transit',
  },
  {
    type: 'driving',
    icon: CarFrontIcon,
    label: 'Driving',
  },
]

useMapListener('click', data => {
  directionsService.fillWaypoint({
    lngLat: data.lngLat,
  })
})
</script>

<template>
  <PanelLayout>
    <div class="space-y-3 flex flex-col">
      <div class="flex items-center gap-2">
        <Tabs v-model="selectedMode" default-value="walking" class="flex-1">
          <TabsList class="w-full flex">
            <TabsTrigger
              v-for="(mode, i) in modes"
              :key="i"
              :value="mode.type"
              class="grow"
              :title="mode.label"
            >
              <component :is="mode.icon" class="size-5" />
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <ResponsivePopover
          v-model:open="showPreferences"
          side="top"
          :side-offset="-48"
          align="end"
          :align-offset="8"
          desktop-content-class="w-[24.5rem] p-0"
          mobile-content-class="px-2"
        >
          <template #trigger>
            <Button
              variant="outline"
              size="icon"
              class="shrink-0"
              :class="showPreferences && 'bg-accent'"
              title="Route preferences"
            >
              <SlidersHorizontalIcon class="size-4" />
            </Button>
          </template>

          <template #content="{ close }">
            <RoutingPreferences
              v-model="routingPreferences"
              :selected-mode="selectedMode"
              @close="close"
            />
          </template>
        </ResponsivePopover>
      </div>

      <WaypointInput
        :model-value="waypoints"
        @update:modelValue="directionsService.setWaypoints"
      />
    </div>

    <!-- Loading state -->
    <div v-if="isLoading" class="flex items-center justify-center py-8">
      <Spinner />
      <span class="ml-2 text-sm text-muted-foreground"> Finding trips... </span>
    </div>

    <!-- Trips results -->
    <TripsList v-else-if="trips" :trips="trips" class="flex-1" />

    <!-- No results -->
    <div
      v-else-if="!isLoading && waypoints.some(wp => wp.lngLat)"
      class="text-center py-8 text-muted-foreground"
    >
      <p class="text-sm">No routes found</p>
    </div>
  </PanelLayout>
</template>
