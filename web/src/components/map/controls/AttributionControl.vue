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

const showDialog = ref(false)
const { camera } = useMapCamera()

const feedbackUrl = computed(() => {
  const { center, zoom } = camera.value
  console.log(center)
  return `https://apps.mapbox.com/feedback/#/${center[0]}/${center[1]}/${zoom}`
})

const attributionLinks = [
  {
    text: '© Mapbox',
    url: 'https://www.mapbox.com/',
  },
  {
    text: '© OpenStreetMap',
    url: 'http://www.openstreetmap.org/copyright',
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
      href="https://www.mapbox.com/"
      target="_blank"
      rel="noopener noreferrer"
      class="block mt-0.5"
    >
      <img :src="mapboxLogo" alt="Mapbox" class="h-5 w-auto" />
    </a>

    <!-- Attribution dialog -->
    <Dialog v-model:open="showDialog">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>This map is powered by:</DialogTitle>
        </DialogHeader>

        <div class="flex flex-col gap-2">
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

          <a
            :href="feedbackUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="text-primary hover:underline"
          >
            Improve this map
          </a>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>

<style></style>
