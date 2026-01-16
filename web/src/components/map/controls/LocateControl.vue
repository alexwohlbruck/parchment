<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { Button } from '@/components/ui/button'
import { Locate } from 'lucide-vue-next'
import { useMapService } from '@/services/map.service'
import { useMapStore } from '@/stores/map.store'
import { ControlVisibility } from '@/types/map.types'

const mapService = useMapService()
const mapStore = useMapStore()
const { controlSettings } = storeToRefs(mapStore)

const isVisible = computed(() => {
  return controlSettings.value.locate === ControlVisibility.ALWAYS
})
</script>

<template>
  <div v-if="isVisible" class="flex flex-col">
    <Button
      variant="default"
      size="icon-sm"
      class="rounded-md size-11"
      @click="mapService.locate()"
    >
      <Locate class="size-5" strokeWidth="2" />
    </Button>
  </div>
</template>
