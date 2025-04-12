<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useAppService } from '@/services/app.service'
import { useDirectionsService } from '@/services/directions.service'
import { mapEventBus } from '@/lib/eventBus'
import { LngLat } from '@/types/map.types'
import { useDirectionsStore } from '@/stores/directions.store'
import { useMapStore } from '@/stores/map.store'
import { encode } from 'pluscodes'
import {
  PencilIcon,
  CopyIcon,
  ArrowDownToDotIcon,
  ArrowUpFromDotIcon,
  PlusIcon,
  ExternalLinkIcon,
} from 'lucide-vue-next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const router = useRouter()
const appService = useAppService()
const directionsService = useDirectionsService()
const directionsStore = useDirectionsStore()
const mapStore = useMapStore()
const { t } = useI18n()

const { waypoints } = storeToRefs(directionsStore)
const { mapCamera } = storeToRefs(mapStore)

const showContextMenu = ref(false)
const contextMenuPosition = ref({ x: 0, y: 0 })
const clickedLngLat = ref<LngLat | null>(null)

onMounted(() => {
  mapEventBus.on('contextmenu', e => {
    contextMenuPosition.value = { x: e.point.x, y: e.point.y - 18 }
    clickedLngLat.value = e.lngLat
    showContextMenu.value = true
  })
})

onUnmounted(() => {
  mapEventBus.off('contextmenu')
})

function copyCoordinates(lngLat: LngLat) {
  const coordString = `${lngLat.lat}, ${lngLat.lng}`
  navigator.clipboard.writeText(coordString)
  appService.toast.info(t('messages.coordinatesCopied'))
}

function copyPlusCode(lngLat: LngLat) {
  const plusCode = encode({ latitude: lngLat.lat, longitude: lngLat.lng })
  if (plusCode) {
    navigator.clipboard.writeText(plusCode)
    appService.toast.info(t('messages.plusCodeCopied'))
  }
}

const useMultistopDirections = computed(() => {
  const filledWaypointsCount = waypoints.value.reduce(
    (count, waypoint) => (waypoint.lngLat ? count + 1 : count),
    0,
  )
  console.log(filledWaypointsCount, waypoints.value.length)
  return waypoints.value.length > 2 || filledWaypointsCount >= 2
})

function directionsTo() {
  router.push('/directions')
  directionsService.directionsTo({
    lngLat: clickedLngLat.value,
  })
}

function directionsFrom() {
  router.push('/directions')
  directionsService.directionsFrom({
    lngLat: clickedLngLat.value,
  })
}

function fillWaypoint() {
  router.push('/directions')
  setTimeout(() => {
    directionsService.fillWaypoint({
      lngLat: clickedLngLat.value,
    })
  }, 0)
}

function openMapEditor(editor: 'id' | 'rapid' | 'josm') {
  if (!clickedLngLat.value) return
  switch (editor) {
    case 'id':
      window.open(
        `https://www.openstreetmap.org/edit?editor=id#map=18/${clickedLngLat.value.lat}/${clickedLngLat.value.lng}`,
        '_blank',
      )
      break
    case 'rapid':
      window.open(
        `https://mapwith.ai/rapid?#map=18/${clickedLngLat.value.lat}/${clickedLngLat.value.lng}&photo_overlay=mapillary&photo=mapillary/147417114029979`,
        '_blank',
      )
      break
    case 'josm':
      window.open(
        `http://127.0.0.1:8111/load_and_zoom?left=${clickedLngLat.value.lng}&right=${clickedLngLat.value.lng}&top=${clickedLngLat.value.lat}&bottom=${clickedLngLat.value.lat}`,
        '_blank',
      )
      break
  }
}

function openExternalMap(service: 'google' | 'apple' | 'bing') {
  if (!clickedLngLat.value) return
  switch (service) {
    case 'google':
      window.open(
        `https://www.google.com/maps/@${clickedLngLat.value.lat},${clickedLngLat.value.lng},${mapCamera.value.zoom}z`,
        '_blank',
      )
      break
    case 'apple':
      const span = Math.pow(2, 20 - mapCamera.value.zoom) / 1024
      window.open(
        `https://maps.apple.com/frame?center=${clickedLngLat.value.lat}%2C${clickedLngLat.value.lng}&span=${span}%2C${span}`,
        '_blank',
      )
      break
    case 'bing':
      window.open(
        `https://www.bing.com/maps?cp=${clickedLngLat.value.lat}~${clickedLngLat.value.lng}&lvl=${mapCamera.value.zoom}`,
        '_blank',
      )
      break
  }
}
</script>

<template>
  <DropdownMenu :open="showContextMenu" @update:open="showContextMenu = $event">
    <div
      :style="{
        position: 'fixed',
        left: `${contextMenuPosition.x}px`,
        top: `${contextMenuPosition.y}px`,
      }"
    >
      <DropdownMenuTrigger> </DropdownMenuTrigger>
    </div>
    <DropdownMenuContent align="start" :side-offset="0">
      <DropdownMenuGroup>
        <DropdownMenuItem
          v-if="!useMultistopDirections"
          @click="directionsFrom()"
        >
          <ArrowUpFromDotIcon class="size-4 rotate-90" />
          <span>{{ $t('directions.directionsFromHere') }}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          v-if="!useMultistopDirections"
          @click="directionsTo()"
        >
          <ArrowDownToDotIcon class="size-4 -rotate-90" />
          <span>{{ $t('directions.directionsToHere') }}</span>
        </DropdownMenuItem>
        <DropdownMenuItem v-if="useMultistopDirections" @click="fillWaypoint()">
          <PlusIcon class="size-4" />
          <span>{{ $t('directions.addStop') }}</span>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <CopyIcon class="mr-2 size-4" />
            <span>{{ $t('map.contextMenu.copyLocation') }}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent>
              <DropdownMenuItem
                @click="copyCoordinates(clickedLngLat)"
                v-if="clickedLngLat"
              >
                <span>
                  {{ clickedLngLat.lat.toFixed(5) }},
                  {{ clickedLngLat.lng.toFixed(5) }}
                </span>
              </DropdownMenuItem>

              <DropdownMenuItem
                @click="copyPlusCode(clickedLngLat)"
                v-if="clickedLngLat"
              >
                <span>{{
                  encode({
                    latitude: clickedLngLat.lat,
                    longitude: clickedLngLat.lng,
                  }) || ''
                }}</span>
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <ExternalLinkIcon class="mr-2 size-4" />
            <span>{{ $t('map.contextMenu.viewIn') }}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent>
              <DropdownMenuItem @click="openExternalMap('google')">
                <span>Google Maps</span>
              </DropdownMenuItem>
              <DropdownMenuItem @click="openExternalMap('apple')">
                <span>Apple Maps</span>
              </DropdownMenuItem>
              <DropdownMenuItem @click="openExternalMap('bing')">
                <span>Bing Maps</span>
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <PencilIcon class="mr-2 size-4" />
            <span>{{ $t('map.contextMenu.edit') }}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent>
              <DropdownMenuItem @click="openMapEditor('id')">
                <span>OpenStreetMap iD</span>
              </DropdownMenuItem>
              <DropdownMenuItem @click="openMapEditor('rapid')">
                <span>Rapid</span>
              </DropdownMenuItem>
              <DropdownMenuItem @click="openMapEditor('josm')">
                <span>JOSM</span>
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
