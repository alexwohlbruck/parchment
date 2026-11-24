<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { InfoIcon } from 'lucide-vue-next'
import { onBeforeUnmount, ref } from 'vue'
import mapboxLogo from '@/assets/img/mapbox-logo.svg'
import googleMapsLogo from '@/assets/img/google-maps-logo.svg'
import { useMapStore } from '@/stores/map.store'
import { MapEngine } from '@/types/map.types'
import { mapEventBus } from '@/lib/event-bus'
import AboutDialog from '@/components/dialogs/AboutDialog.vue'

const mapStore = useMapStore()
const showDialog = ref(false)

/** Google's credits for the 3D imagery on screen; its terms require them visible, beside its logo. */
const googleCredits = ref<string | null>(null)
const onCredits = (credits: string | null) => (googleCredits.value = credits)
mapEventBus.on('imagery:credits', onCredits)
onBeforeUnmount(() => mapEventBus.off('imagery:credits', onCredits))
</script>

<template>
  <div class="flex items-center gap-1.5 min-w-0">
    <!-- Attribution info button -->
    <Button
      variant="outline"
      size="icon-xs"
      class="rounded-md shrink-0"
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

    <template v-if="googleCredits">
      <img :src="googleMapsLogo" alt="Google Maps" class="h-4 w-auto shrink-0 ml-2" />
      <span class="truncate text-[10px] leading-none text-white [text-shadow:0_0_2px_rgb(0_0_0/0.8)]">
        {{ googleCredits }}
      </span>
    </template>

    <!-- About dialog -->
    <AboutDialog v-model:open="showDialog" />
  </div>
</template>

<style></style>
