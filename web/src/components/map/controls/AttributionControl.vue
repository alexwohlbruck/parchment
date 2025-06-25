<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { InfoIcon } from 'lucide-vue-next'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ref, computed } from 'vue'
import mapboxLogo from '@/assets/img/mapbox-logo.svg'
import { useMapCamera } from '@/composables/useMapCamera'
import Separator from '@/components/ui/separator/Separator.vue'
import {
  siGithub,
  siX,
  siThreads,
  siMapbox,
  siOpenstreetmap,
} from 'simple-icons'
import BrandIcon from '@/components/ui/brand-icon/BrandIcon.vue'
import { useMapStore } from '@/stores/map.store'
import { MapEngine } from '@/types/map.types'

const mapStore = useMapStore()
const showDialog = ref(false)
const { camera } = useMapCamera()

const feedbackUrl = computed(() => {
  const { center, zoom } = camera.value
  console.log(center)
  const [lng, lat] = Array.isArray(center)
    ? center
    : 'lon' in center
    ? [center.lon, center.lat]
    : [center.lng, center.lat]
  return `https://apps.mapbox.com/feedback/#/${lng}/${lat}/${zoom}`
})

const attributionLinks = computed(() => {
  if (mapStore.mapEngine === MapEngine.MAPBOX) {
    return [
      {
        text: '© Mapbox',
        url: 'https://www.mapbox.com/',
      },
      {
        text: '© OpenStreetMap',
        url: 'http://www.openstreetmap.org/copyright',
      },
    ]
  }
  return [
    {
      text: '© MapLibre',
      url: 'https://maplibre.org/',
    },
    {
      text: '© OpenStreetMap',
      url: 'http://www.openstreetmap.org/copyright',
    },
  ]
})

const socialLinks = [
  {
    text: 'GitHub',
    url: 'https://github.com/alexwohlbruck/parchment?ref=parchment',
    icon: siGithub,
    color: `#${siGithub.hex}`,
  },
  {
    text: 'Twitter',
    url: 'https://twitter.com/parchmentmaps?ref=parchment',
    icon: siX,
    color: `#${siX.hex}`,
  },
  {
    text: 'Threads',
    url: 'https://www.threads.net/@parchmentmaps?ref=parchment',
    icon: siThreads,
    color: `#${siThreads.hex}`,
  },
]
</script>

<template>
  <div class="flex items-center gap-1.5">
    <!-- Attribution info button -->
    <Button
      variant="outline"
      size="icon-xs"
      class="rounded-md shadow-md"
      @click="showDialog = true"
    >
      <InfoIcon class="size-3.5" />
    </Button>

    <!-- Mapbox logo -->
    <a
      v-if="mapStore.mapEngine === MapEngine.MAPBOX"
      href="https://www.mapbox.com/"
      target="_blank"
      rel="noopener noreferrer"
      class="block mt-0.5"
    >
      <img :src="mapboxLogo" alt="Mapbox" class="h-5 w-auto" />
    </a>

    <!-- Attribution dialog -->
    <Dialog v-model:open="showDialog">
      <DialogContent class="max-w-100">
        <DialogHeader>
          <DialogTitle>Parchment is powered by:</DialogTitle>
        </DialogHeader>

        <div class="flex flex-col gap-4">
          <div class="flex flex-wrap flex-col gap-x-2 gap-y-1">
            <template v-for="(link, index) in attributionLinks" :key="index">
              <a
                :href="link.url"
                target="_blank"
                rel="noopener noreferrer"
                class="text-primary hover:underline"
              >
                {{ link.text }}
              </a>
            </template>
          </div>

          <Separator class="w-full" />

          <div class="flex gap-2">
            <a
              href="https://wiki.openstreetmap.org/wiki/How_to_contribute"
              target="_blank"
              rel="noopener noreferrer"
              class="flex-1"
            >
              <Button variant="outline" class="w-full">
                <BrandIcon
                  :icon="siOpenstreetmap"
                  class="size-4 mr-2"
                  use-theme-color
                />
                Contribute
              </Button>
            </a>

            <a
              v-if="mapStore.mapEngine === MapEngine.MAPBOX"
              :href="feedbackUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="flex-1"
            >
              <Button variant="outline" class="w-full">
                <BrandIcon
                  :icon="siMapbox"
                  class="size-4 mr-2"
                  use-theme-color
                />
                Improve this map
              </Button>
            </a>
          </div>

          <Separator class="w-full" />

          <div class="flex gap-2">
            <template v-for="(link, index) in socialLinks" :key="index">
              <a :href="link.url" target="_blank" class="flex-1">
                <Button variant="outline" class="w-full">
                  <BrandIcon
                    :icon="link.icon"
                    class="size-4 mr-2"
                    use-theme-color
                  />
                  {{ link.text }}
                </Button>
              </a>
            </template>
          </div>

          <div class="text-xs font-medium text-center mt-2">
            Made with ❤️ by
            <a
              href="https://alex.wohlbruck.com"
              target="_blank"
              rel="noopener noreferrer"
              class="hover:underline"
              >Alex Wohlbruck</a
            >.
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>

<style></style>
