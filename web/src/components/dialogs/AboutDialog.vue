<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ResponsiveDialog from '@/components/responsive/ResponsiveDialog.vue'
import { useMapCamera } from '@/composables/useMapCamera'
import {
  siGithub,
  siX,
  siThreads,
  siInstagram,
  siMapbox,
  siOpenstreetmap,
} from 'simple-icons'
import BrandIcon from '@/components/ui/brand-icon/BrandIcon.vue'
import { useMapStore } from '@/stores/map.store'
import { MapEngine } from '@/types/map.types'
import { APP_NAME, APP_VERSION } from '@/lib/constants'
import ParchmentLogo from '@/assets/parchment.svg'
import parchmentMapBg from '@/assets/img/parchment-map.png'
import { Button } from '@/components/ui/button'
import Chip from '@/components/ui/chip/Chip.vue'

const props = defineProps<{
  open?: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const { t } = useI18n()
const mapStore = useMapStore()
const { camera } = useMapCamera()

const internalOpen = computed({
  get: () => props.open ?? false,
  set: (value: boolean) => emit('update:open', value),
})

const feedbackUrl = computed(() => {
  const { center, zoom } = camera.value
  const [lng, lat] = Array.isArray(center)
    ? center
    : 'lon' in center
    ? [center.lon, center.lat]
    : [center.lng, center.lat]
  return `https://apps.mapbox.com/feedback/#/${lng}/${lat}/${zoom}`
})

const attributionLinks = computed(() => {
  if (mapStore.settings.engine === MapEngine.MAPBOX) {
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
  {
    text: 'Instagram',
    url: 'https://www.instagram.com/parchmentmaps?ref=parchment',
    icon: siInstagram,
    color: `#${siInstagram.hex}`,
  },
]
</script>

<template>
  <ResponsiveDialog v-model:open="internalOpen" content-class="p-0 overflow-hidden" no-padding :show-drag-handle="false" fit-content>
    <template #trigger>
      <!-- Hidden trigger for programmatic control -->
      <div style="display: none" />
    </template>
    <template #content>
      <div class="about-dialog relative overflow-hidden pt-6 sm:pt-0">
        <!-- Background map image with gradient fade -->
        <div class="absolute inset-0 pointer-events-none -z-10">
          <img
            :src="parchmentMapBg"
            alt=""
            draggable="false"
            class="absolute top-0 left-1/2 -translate-x-1/2 w-[140%] max-w-none opacity-55 dark:invert"
          />
          <!-- Gradient overlay to fade the map into the background -->
          <div class="absolute inset-0 bg-gradient-to-b from-transparent via-background/70 to-background" />
        </div>

        <!-- Gradient accent blobs using theme primary color -->
        <div class="absolute -top-20 -right-20 w-64 h-64 bg-primary/[0.08] rounded-full blur-3xl pointer-events-none -z-10" />
        <div class="absolute -bottom-20 -left-20 w-64 h-64 bg-primary/5 rounded-full blur-3xl pointer-events-none -z-10" />

        <!-- Content -->
        <div class="relative z-10 flex flex-col gap-5 p-6">
          <!-- Logo and title header -->
          <div class="flex flex-col items-center pt-2">
            <div class="relative">
              <img
                :src="ParchmentLogo"
                :alt="APP_NAME"
                draggable="false"
                class="relative size-20 drop-shadow-lg dark:brightness-0 dark:invert"
              />
            </div>
            <div class="text-center mt-3">
              <h2 class="text-2xl font-bold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">
                {{ APP_NAME }}
              </h2>
              <span class="text-sm text-muted-foreground font-medium">
                v{{ APP_VERSION }}
              </span>
            </div>
          </div>

          <!-- Powered by section -->
          <div class="flex flex-col gap-2 bg-muted/40 backdrop-blur-sm rounded-xl p-4 border border-border/50">
            <span class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {{ t('attribution.poweredBy') }}
            </span>
            <div class="flex flex-wrap gap-2">
              <template v-for="(link, index) in attributionLinks" :key="index">
                <a
                  :href="link.url"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Chip :label="link.text" size="sm" />
                </a>
              </template>
            </div>
          </div>

          <!-- Action buttons -->
          <div class="flex gap-2">
            <a
              href="https://wiki.openstreetmap.org/wiki/How_to_contribute"
              target="_blank"
              rel="noopener noreferrer"
              class="flex-1"
            >
              <Button variant="outline" class="w-full h-11 bg-background/60 backdrop-blur-sm hover:bg-emerald-500/10 hover:border-emerald-500/30 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors">
                <BrandIcon
                  :icon="siOpenstreetmap"
                  class="size-4 mr-2"
                  use-theme-color
                />
                {{ t('attribution.contribute') }}
              </Button>
            </a>

            <a
              v-if="mapStore.settings.engine === MapEngine.MAPBOX"
              :href="feedbackUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="flex-1"
            >
              <Button variant="outline" class="w-full h-11 bg-background/60 backdrop-blur-sm hover:bg-blue-500/10 hover:border-blue-500/30 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                <BrandIcon
                  :icon="siMapbox"
                  class="size-4 mr-2"
                  use-theme-color
                />
                {{ t('attribution.improveThisMap') }}
              </Button>
            </a>
          </div>

          <!-- Social links -->
          <div class="grid grid-cols-4 gap-2">
            <a
              v-for="(link, index) in socialLinks"
              :key="index"
              :href="link.url"
              target="_blank"
              class="group"
            >
              <Button
                variant="outline"
                class="w-full h-12 flex-col gap-1 bg-background/40 backdrop-blur-sm transition-all"
              >
                <BrandIcon
                  :icon="link.icon"
                  class="size-4 transition-transform"
                  use-theme-color
                />
                <span class="text-[10px] font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                  {{ link.text }}
                </span>
              </Button>
            </a>
          </div>

          <!-- Footer -->
          <div class="text-xs text-muted-foreground text-center pt-2 border-t border-border/30">
            {{ t('attribution.madeWith') }}
            <a
              href="https://alex.wohlbruck.com"
              target="_blank"
              rel="noopener noreferrer"
              class="font-medium text-foreground hover:text-primary transition-colors"
            >
              Alex Wohlbruck
            </a>
          </div>
        </div>
      </div>
    </template>
  </ResponsiveDialog>
</template>
