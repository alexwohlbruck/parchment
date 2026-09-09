<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { InfoIcon } from 'lucide-vue-next'
import { ref } from 'vue'
import mapboxLogo from '@/assets/img/mapbox-logo.svg'
import { useMapStore } from '@/stores/map.store'
import { MapEngine } from '@/types/map.types'
import AboutDialog from '@/components/dialogs/AboutDialog.vue'

const mapStore = useMapStore()
const showDialog = ref(false)
</script>

<template>
  <div class="flex items-center gap-1.5">
    <!-- Attribution info button -->
    <Button
      variant="outline"
      size="icon-xs"
      class="rounded-md"
      @click="showDialog = true"
    >
      <InfoIcon class="size-3.5" />
    </Button>

    <!-- Mapbox logo -->
    <a
      v-if="mapStore.settings.engine === MapEngine.MAPBOX"
      href="https://www.mapbox.com/"
      target="_blank"
      rel="noopener noreferrer"
      class="block mt-0.5"
    >
      <img :src="mapboxLogo" alt="Mapbox" class="h-5 w-auto" />
    </a>

    <!-- About dialog -->
    <AboutDialog v-model:open="showDialog" />
  </div>
</template>

<style></style>
