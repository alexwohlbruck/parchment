<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { Button } from '@/components/ui/button'
import { Locate, LocateOff, Loader2 } from 'lucide-vue-next'
import { useMapService } from '@/services/map.service'
import { useMapStore } from '@/stores/map.store'
import { useGeolocationService } from '@/services/geolocation.service'
import { ControlVisibility } from '@/types/map.types'

const mapService = useMapService()
const mapStore = useMapStore()
const geolocation = useGeolocationService()
const { controlSettings } = storeToRefs(mapStore)

const isVisible = computed(() => {
  return controlSettings.value.locate === ControlVisibility.ALWAYS
})

const isDenied = computed(() => geolocation.permissionState.value === 'denied')
const isWaiting = computed(() => {
  return geolocation.permissionState.value === 'prompt' && !geolocation.hasLocation.value
})
</script>

<template>
  <div v-if="isVisible" class="flex flex-col">
    <Button
      variant="default"
      size="icon-sm"
      class="rounded-md size-11"
      :disabled="isDenied"
      @click="mapService.locate()"
    >
      <LocateOff v-if="isDenied" class="size-5" strokeWidth="2" />
      <Loader2 v-else-if="isWaiting" class="size-5 animate-spin" strokeWidth="2" />
      <Locate v-else class="size-5" strokeWidth="2" />
    </Button>
  </div>
</template>
