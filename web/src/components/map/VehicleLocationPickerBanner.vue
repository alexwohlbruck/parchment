<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useVehiclesStore } from '@/stores/vehicles.store'
import { useVehicleLocationPicker } from '@/composables/useVehicleLocationPicker'
import { VEHICLE_TYPE_LABELS } from '@/lib/vehicle-mode-mapping'
import type { VehicleType } from '@/types/multimodal.types'
import { Button } from '@/components/ui/button'
import { MapPinIcon, XIcon } from 'lucide-vue-next'

const vehiclesStore = useVehiclesStore()
const { pickingVehicle } = storeToRefs(vehiclesStore)
const { cancel } = useVehicleLocationPicker()
</script>

<template>
  <Transition
    enter-active-class="transition duration-200 ease-out"
    enter-from-class="-translate-y-full opacity-0"
    enter-to-class="translate-y-0 opacity-100"
    leave-active-class="transition duration-150 ease-in"
    leave-from-class="translate-y-0 opacity-100"
    leave-to-class="-translate-y-full opacity-0"
  >
    <div
      v-if="pickingVehicle"
      class="pointer-events-auto absolute top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl border bg-background/95 backdrop-blur-sm px-4 py-2.5 shadow-lg"
    >
      <MapPinIcon class="size-4 text-primary shrink-0" />
      <span class="text-sm font-medium whitespace-nowrap">
        Click to set location for
        <strong>{{ pickingVehicle.name || VEHICLE_TYPE_LABELS[pickingVehicle.type as VehicleType] || pickingVehicle.type }}</strong>
      </span>
      <Button
        variant="ghost"
        size="icon"
        class="size-6 shrink-0"
        @click="cancel()"
      >
        <XIcon class="size-3.5" />
      </Button>
    </div>
  </Transition>
</template>
