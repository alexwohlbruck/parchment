<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ChevronDownIcon, RouteIcon } from 'lucide-vue-next'
import { AppRoute } from '@/router'
import PanelLayout from '@/components/sheet/layouts/PanelLayout.vue'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { FREE_MODE_ICONS } from '@/components/guidance/free-mode-icons'
import { useStartFreeRoam } from '@/composables/guidance/useStartFreeRoam'
import { useGeolocationService } from '@/services/geolocation.service'
import { useGeocodingService } from '@/services/geocoding.service'
import { useDirectionsService } from '@/services/directions.service'
import { getSearchResultName } from '@/lib/search/search-result'
import { bannerDistance } from '@/lib/guidance/guidance-display'
import { useAppStore } from '@/stores/app.store'
import { UnitSystem } from '@/types/map.types'

const { t } = useI18n()
const router = useRouter()
const geolocation = useGeolocationService()
const { reverseGeocode } = useGeocodingService()
const directionsService = useDirectionsService()
const appStore = useAppStore()
const startFreeRoam = useStartFreeRoam()

const address = ref<string | null>(null)
let geocodedOnce = false
watch(
  geolocation.lngLat,
  async position => {
    if (!position || geocodedOnce) return
    geocodedOnce = true
    try {
      const { results } = await reverseGeocode({ lat: position.lat, lng: position.lng, limit: 1 })
      address.value = results[0] ? getSearchResultName(results[0]) : null
    } catch {
      address.value = null
    }
  },
  { immediate: true },
)

const accuracy = computed(() => {
  const meters = geolocation.accuracy.value
  if (meters == null) return null
  const { value, unit } = bannerDistance(meters, appStore.unitSystem === UnitSystem.METRIC)
  return t('myLocation.accuracy', { distance: `${value} ${t(`guidance.units.${unit}`)}` })
})

const coordinates = computed(() => {
  const position = geolocation.lngLat.value
  return position ? `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}` : null
})

function directions() {
  directionsService.populateOriginWithCurrentLocation()
  router.push({ name: AppRoute.DIRECTIONS })
}

const OTHER_MODES = ['walking', 'cycling'] as const
</script>

<template>
  <PanelLayout>
    <div class="space-y-4">
      <div class="space-y-1">
        <h1 class="text-2xl font-semibold">{{ t('myLocation.title') }}</h1>
        <p v-if="coordinates" class="text-sm text-muted-foreground">
          {{ address ?? coordinates }}<template v-if="accuracy"> · {{ accuracy }}</template>
        </p>
        <p v-else class="text-sm text-muted-foreground">{{ t('guidance.waitingForLocation') }}</p>
      </div>

      <div class="flex gap-2">
        <div class="flex flex-1">
          <Button class="flex-1 rounded-r-none" :disabled="!coordinates" @click="startFreeRoam('driving')">
            <component :is="FREE_MODE_ICONS.driving" class="mr-2 size-4" />
            {{ t('guidance.free.start.driving') }}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button
                class="rounded-l-none border-l border-primary-foreground/20 px-2.5"
                :disabled="!coordinates"
                :aria-label="t('guidance.free.otherModes')"
              >
                <ChevronDownIcon class="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem v-for="mode in OTHER_MODES" :key="mode" @select="startFreeRoam(mode)">
                <component :is="FREE_MODE_ICONS[mode]" class="mr-2 size-4" />
                {{ t(`guidance.free.start.${mode}`) }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <Button class="flex-1" variant="outline" @click="directions">
          <RouteIcon class="mr-2 size-4" />
          {{ t('directions.directions') }}
        </Button>
      </div>
    </div>
  </PanelLayout>
</template>
