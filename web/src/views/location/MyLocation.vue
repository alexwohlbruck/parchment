<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ChevronDownIcon, RouteIcon } from 'lucide-vue-next'
import { AppRoute } from '@/router'
import PlacePanel from '@/components/place/PlacePanel.vue'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { FREE_MODE_ICONS } from '@/components/guidance/free-mode-icons'
import { useStartFreeRoam } from '@/composables/guidance/useStartFreeRoam'
import { useAbortController } from '@/composables/useAbortController'
import { useGeolocationService } from '@/services/geolocation.service'
import { usePlaceService } from '@/services/place/place.service'
import { useDirectionsService } from '@/services/directions.service'
import { formatAddress } from '@/lib/place/place-details'
import { bannerDistance } from '@/lib/guidance/guidance-display'
import { FREE_MODES } from '@/lib/guidance/free-roam'
import { useAppStore } from '@/stores/app.store'
import { useGuidanceStore } from '@/stores/guidance.store'
import { UnitSystem } from '@/types/map.types'
import type { Place } from '@/types/place.types'

const { t } = useI18n()
const router = useRouter()
const geolocation = useGeolocationService()
const { fetchPlaceDetailsByCoordinates } = usePlaceService()
const directionsService = useDirectionsService()
const appStore = useAppStore()
const guidance = useGuidanceStore()
const startFreeRoam = useStartFreeRoam()
const { nextSignal } = useAbortController()

const resolved = shallowRef<Place | null>(null)
const loading = shallowRef(false)

async function resolvePlace() {
  const position = geolocation.lngLat.value
  if (!position) return
  loading.value = true
  try {
    resolved.value = await fetchPlaceDetailsByCoordinates(position.lat, position.lng, undefined, nextSignal())
  } finally {
    loading.value = false
  }
}

let requested = false
watch(
  geolocation.lngLat,
  position => {
    if (!position || requested) return
    requested = true
    void resolvePlace()
  },
  { immediate: true },
)

/** Without a resolved place the panel still shows the coordinates themselves. */
const place = computed<Partial<Place>>(() => {
  if (resolved.value) return resolved.value
  const position = geolocation.lngLat.value
  if (!position) return {}
  return {
    geometry: {
      value: { type: 'point', center: { lat: position.lat, lng: position.lng } },
      sourceId: 'local',
      timestamp: new Date().toISOString(),
    },
  }
})

const located = computed(() => !!geolocation.lngLat.value)

const accuracy = computed(() => {
  const meters = geolocation.accuracy.value
  if (meters == null) return null
  const { value, unit } = bannerDistance(meters, appStore.unitSystem === UnitSystem.METRIC)
  return t('myLocation.accuracy', { distance: `${value} ${t(`guidance.units.${unit}`)}` })
})

const label = computed(() => {
  const position = geolocation.lngLat.value
  if (!position) return null
  return (
    resolved.value?.name?.value ||
    (resolved.value && formatAddress(resolved.value)) ||
    `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}`
  )
})

const otherModes = computed(() => FREE_MODES.filter(mode => mode !== guidance.freeMode))

function directions() {
  directionsService.populateOriginWithCurrentLocation()
  router.push({ name: AppRoute.DIRECTIONS })
}
</script>

<template>
  <PlacePanel :place="place" :loading="loading || !located">
    <template #header>
      <div class="space-y-1">
        <h1 class="text-[28px] leading-[1.05] pb-[0.2em] -mb-[0.2em]">{{ t('myLocation.title') }}</h1>
        <p class="text-sm text-muted-foreground">
          <template v-if="label">
            {{ label }}<template v-if="accuracy"> · {{ accuracy }}</template>
          </template>
          <template v-else>{{ t('guidance.waitingForLocation') }}</template>
        </p>
      </div>
    </template>

    <template #actions>
      <div class="flex gap-2">
        <div class="flex flex-1">
          <Button class="flex-1 rounded-r-none" :disabled="!located" @click="startFreeRoam(guidance.freeMode)">
            <component :is="FREE_MODE_ICONS[guidance.freeMode]" class="mr-2 size-4" />
            {{ t(`guidance.free.start.${guidance.freeMode}`) }}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button
                class="rounded-l-none border-l border-primary-foreground/20 px-2.5"
                :disabled="!located"
                :aria-label="t('guidance.free.otherModes')"
              >
                <ChevronDownIcon class="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem v-for="mode in otherModes" :key="mode" @select="startFreeRoam(mode)">
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
    </template>
  </PlacePanel>
</template>
