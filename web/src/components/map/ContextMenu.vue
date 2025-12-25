<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed, watch, h } from 'vue'
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
import type { MenuItemDefinition } from '@/components/responsive/ResponsiveDropdown.vue'
import BrandIcon from '@/components/ui/brand-icon/BrandIcon.vue'
import { useExternalLink } from '@/composables/useExternalLink'
import { siOpenstreetmap, siGooglemaps, siApple } from 'simple-icons/icons'
import {
  PencilIcon,
  CopyIcon,
  ArrowDownToDotIcon,
  ArrowUpFromDotIcon,
  PlusIcon,
  ExternalLinkIcon,
  MapIcon,
} from 'lucide-vue-next'
import ResponsiveDropdown from '@/components/responsive/ResponsiveDropdown.vue'

const router = useRouter()
const appService = useAppService()
const directionsService = useDirectionsService()
const directionsStore = useDirectionsStore()
const mapStore = useMapStore()
const { t } = useI18n()
const { openExternalLink } = useExternalLink()

const { waypoints } = storeToRefs(directionsStore)
const { mapCamera } = storeToRefs(mapStore)

const showContextMenu = ref(false)
const contextMenuPosition = ref({ x: 0, y: 0 })
const clickedLngLat = ref<LngLat | null>(null)

onMounted(() => {
  mapEventBus.on('contextmenu', e => {
    contextMenuPosition.value = { x: e.point.x + 52, y: e.point.y - 4 } // TODO: Fix offset (something to do with viewport width, sidebar)
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
  directionsService.fillWaypoint({
    lngLat: clickedLngLat.value,
  })
}

function openMapEditor(editor: 'id' | 'rapid' | 'josm') {
  if (!clickedLngLat.value) return
  switch (editor) {
    case 'id':
      openExternalLink(
        `https://www.openstreetmap.org/edit?editor=id#map=18/${clickedLngLat.value.lat}/${clickedLngLat.value.lng}`,
        '_blank',
      )
      break
    case 'rapid':
      openExternalLink(
        `https://mapwith.ai/rapid?#map=18/${clickedLngLat.value.lat}/${clickedLngLat.value.lng}&photo_overlay=mapillary&photo=mapillary/147417114029979`,
        '_blank',
      )
      break
    case 'josm':
      openExternalLink(
        `http://127.0.0.1:8111/load_and_zoom?left=${clickedLngLat.value.lng}&right=${clickedLngLat.value.lng}&top=${clickedLngLat.value.lat}&bottom=${clickedLngLat.value.lat}`,
        '_blank',
      )
      break
  }
}

function openExternalMap(
  service: 'osm' | 'google' | 'apple' | 'yandex' | '2gis',
) {
  if (!clickedLngLat.value) return
  switch (service) {
    case 'osm':
      openExternalLink(
        `https://www.openstreetmap.org/#map=${Math.ceil(
          mapCamera.value.zoom,
        )}/${clickedLngLat.value.lat}/${clickedLngLat.value.lng}`,
        '_blank',
      )
      break
    case 'google':
      openExternalLink(
        `https://www.google.com/maps/@${clickedLngLat.value.lat},${clickedLngLat.value.lng},${mapCamera.value.zoom}z`,
        '_blank',
      )
      break
    case 'apple':
      const span = Math.pow(2, 20 - mapCamera.value.zoom) / 1024
      openExternalLink(
        `https://maps.apple.com/frame?center=${clickedLngLat.value.lat}%2C${clickedLngLat.value.lng}&span=${span}%2C${span}`,
        '_blank',
      )
      break
    case 'yandex':
      openExternalLink(
        `https://yandex.com/maps/?ll=${clickedLngLat.value.lng}%2C${
          clickedLngLat.value.lat
        }&z=${Math.ceil(mapCamera.value.zoom)}`,
        '_blank',
      )
      break
    case '2gis':
      openExternalLink(
        `https://2gis.ae/?m=${clickedLngLat.value.lng}%2C${clickedLngLat.value.lat}%2F${mapCamera.value.zoom}&immersive=on`,
        '_blank',
      )
      break
  }
}

// Build menu items based on current state
const menuItems = computed<MenuItemDefinition[]>(() => {
  const items: MenuItemDefinition[] = []

  const OsmIcon = () => h(BrandIcon, { icon: siOpenstreetmap, class: 'size-4' })
  const GoogleMapsIcon = () =>
    h(BrandIcon, { icon: siGooglemaps, class: 'size-4' })
  const AppleMapsIcon = () =>
    h(BrandIcon, { icon: siApple, class: 'size-4', useThemeColor: true })
  const GenericMapsIcon = MapIcon

  // Directions items
  if (!useMultistopDirections.value) {
    items.push({
      type: 'item',
      id: 'directions-from',
      label: t('directions.planRouteFromHere'),
      icon: ArrowUpFromDotIcon,
      onSelect: directionsFrom,
    })
    items.push({
      type: 'item',
      id: 'directions-to',
      label: t('directions.directionsHere'),
      icon: ArrowDownToDotIcon,
      onSelect: directionsTo,
    })
  } else {
    items.push({
      type: 'item',
      id: 'add-stop',
      label: t('directions.addStop'),
      icon: PlusIcon,
      onSelect: fillWaypoint,
    })
  }

  items.push({ type: 'separator' })

  // Copy location submenu
  if (clickedLngLat.value) {
    const coords = clickedLngLat.value
    const plusCode = encode({ latitude: coords.lat, longitude: coords.lng })

    items.push({
      type: 'submenu',
      id: 'copy-location',
      label: t('map.contextMenu.copyLocation'),
      icon: CopyIcon,
      items: [
        {
          type: 'item',
          id: 'copy-coords',
          label: `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`,
          onSelect: () => copyCoordinates(coords),
        },
        {
          type: 'item',
          id: 'copy-pluscode',
          label: plusCode || '',
          onSelect: () => copyPlusCode(coords),
        },
      ],
    })
  }

  // View in external maps submenu
  items.push({
    type: 'submenu',
    id: 'view-in',
    label: t('map.contextMenu.viewIn'),
    icon: ExternalLinkIcon,
    items: [
      {
        type: 'item',
        id: 'view-osm',
        label: 'OpenStreetMap',
        icon: OsmIcon,
        onSelect: () => openExternalMap('osm'),
      },
      {
        type: 'item',
        id: 'view-google',
        label: 'Google Maps',
        icon: GoogleMapsIcon,
        onSelect: () => openExternalMap('google'),
      },
      {
        type: 'item',
        id: 'view-apple',
        label: 'Apple Maps',
        icon: AppleMapsIcon,
        onSelect: () => openExternalMap('apple'),
      },
      {
        type: 'item',
        id: 'view-yandex',
        label: 'Yandex Maps',
        icon: GenericMapsIcon,
        onSelect: () => openExternalMap('yandex'),
      },
      {
        type: 'item',
        id: 'view-2gis',
        label: '2GIS',
        icon: GenericMapsIcon,
        onSelect: () => openExternalMap('2gis'),
      },
    ],
  })

  // Edit submenu
  items.push({
    type: 'submenu',
    id: 'edit',
    label: t('map.contextMenu.edit'),
    icon: PencilIcon,
    items: [
      {
        type: 'item',
        id: 'edit-id',
        label: 'OpenStreetMap iD',
        onSelect: () => openMapEditor('id'),
      },
      {
        type: 'item',
        id: 'edit-rapid',
        label: 'Rapid',
        onSelect: () => openMapEditor('rapid'),
      },
      {
        type: 'item',
        id: 'edit-josm',
        label: 'JOSM',
        onSelect: () => openMapEditor('josm'),
      },
    ],
  })

  return items
})
</script>

<template>
  <ResponsiveDropdown
    v-model:open="showContextMenu"
    :items="menuItems"
    align="start"
    :side-offset="0"
    :custom-snap-points="['450px', 0.7]"
  >
    <template #trigger>
      <div
        :style="{
          position: 'fixed',
          left: `${contextMenuPosition.x}px`,
          top: `${contextMenuPosition.y}px`,
          width: '1px',
          height: '1px',
        }"
      />
    </template>
  </ResponsiveDropdown>
</template>
