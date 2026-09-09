<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { Button } from '@/components/ui/button'
import { Plus, Minus } from 'lucide-vue-next'
import { useMapService } from '@/services/map.service'
import { useMapStore } from '@/stores/map.store'
import { ControlVisibility } from '@/types/map.types'

const mapService = useMapService()
const mapStore = useMapStore()
const { controlSettings } = storeToRefs(mapStore)

const isVisible = computed(() => {
  return controlSettings.value.zoom === ControlVisibility.ALWAYS
})
</script>

<template>
  <div v-if="isVisible" class="flex flex-col rounded-md">
    <Button
      variant="outline"
      size="icon-md"
      class="rounded-none rounded-t-md"
      @click="mapService.zoomIn()"
    >
      <Plus class="size-4" strokeWidth="2" />
    </Button>
    <Button
      variant="outline"
      size="icon-md"
      class="rounded-none rounded-b-md border-t-0"
      @click="mapService.zoomOut()"
    >
      <Minus class="size-4" strokeWidth="2" />
    </Button>
  </div>
</template>
