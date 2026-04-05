<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed, watch, h } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useAppService } from '@/services/app.service'
import { useMapService } from '@/services/map.service'
import { useDirectionsService } from '@/services/directions.service'
import { useGeocodingService } from '@/services/geocoding.service'
import { mapEventBus } from '@/lib/eventBus'
import { LngLat } from '@/types/map.types'
import { useDirectionsStore } from '@/stores/directions.store'
import { useMapStore } from '@/stores/map.store'
import { useMapToolsStore } from '@/stores/map-tools.store'
import { encode } from 'pluscodes'
import type { MenuItemDefinition } from '@/components/responsive/ResponsiveDropdown.vue'
import BrandIcon from '@/components/ui/brand-icon/BrandIcon.vue'
import { useExternalLink } from '@/composables/useExternalLink'
import { siOpenstreetmap, siGooglemaps, siApple } from 'simple-icons/icons'
import {
  PencilIcon,
  MessageSquarePlusIcon,
  CopyIcon,
  ArrowDownToDotIcon,
  ArrowUpFromDotIcon,
  PlusIcon,
  ExternalLinkIcon,
  MapIcon,
  MapPinIcon,
  RulerIcon,
  CircleDotIcon,
} from 'lucide-vue-next'
import ResponsiveDropdown from '@/components/responsive/ResponsiveDropdown.vue'
import { Skeleton } from '@/components/ui/skeleton'
import { formatAddress } from '@/lib/place.utils'
import {
  findSegmentToInsert,
  distancePx,
  shouldCloseLoop,
  INSERT_THRESHOLD_PX,
  CLOSE_LOOP_THRESHOLD_PX,
  VERTEX_NEAR_PX,
} from '@/lib/measure.utils'
import { AppRoute } from '@/router'

const router = useRouter()
const appService = useAppService()
const directionsService = useDirectionsService()
const directionsStore = useDirectionsStore()
const mapStore = useMapStore()
const mapToolsStore = useMapToolsStore()
const { t } = useI18n()
const { openExternalLink } = useExternalLink()

const { waypoints } = storeToRefs(directionsStore)
const { mapCamera } = storeToRefs(mapStore)

const mapService = useMapService()
const showContextMenu = ref(false)
const contextMenuPosition = ref({ x: 0, y: 0 })
const clickedLngLat = ref<LngLat | null>(null)
/** Raw map container pixel coords from contextmenu (for measure tool hit testing) */
const clickedPoint = ref<{ x: number; y: number } | null>(null)
const geocodedPlaceName = ref<string | null>(null)
const geocodedAddress = ref<string | null>(null)
const geocodedOsmId = ref<string | null>(null)
const geocodedPlaceId = ref<{ provider: string; id: string } | null>(null)
const isGeocoding = ref(false)

onMounted(() => {
  mapEventBus.on('contextmenu', e => {
    contextMenuPosition.value = { x: e.point.x + 52, y: e.point.y - 4 } // TODO: Fix offset (something to do with viewport width, sidebar)
    clickedLngLat.value = e.lngLat
    clickedPoint.value = e.point
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

function copyPlaceName() {
  if (geocodedPlaceName.value) {
    navigator.clipboard.writeText(geocodedPlaceName.value)
    appService.toast.info(t('messages.placeNameCopied', 'Place name copied'))
  }
}

function copyAddress() {
  if (geocodedAddress.value) {
    navigator.clipboard.writeText(geocodedAddress.value)
    appService.toast.info(t('messages.addressCopied', 'Address copied'))
  }
}

function openPlaceAtLocation() {
  if (!clickedLngLat.value) return

  // Priority 1: If we have an OSM ID from geocoding, open the full OSM place
  if (geocodedOsmId.value) {
    const [type, id] = geocodedOsmId.value.split('/')
    router.push({
      name: AppRoute.PLACE,
      params: { type, id },
    })
  }
  // Priority 2: If we have a provider-specific place ID (e.g., Geoapify), use provider lookup
  else if (geocodedPlaceId.value) {
    router.push({
      name: AppRoute.PLACE_PROVIDER,
      params: {
        provider: geocodedPlaceId.value.provider,
        placeId: geocodedPlaceId.value.id,
      },
    })
  }
  // Priority 3: If we have a place name (but no ID), use name+coordinate lookup
  else if (geocodedPlaceName.value) {
    router.push({
      name: AppRoute.PLACE_LOCATION,
      params: {
        name: geocodedPlaceName.value,
        lat: clickedLngLat.value.lat.toString(),
        lng: clickedLngLat.value.lng.toString(),
      },
    })
  }
  // Priority 4: No name or ID, use coordinate-only lookup
  else {
    router.push({
      name: AppRoute.PLACE_COORDS,
      params: {
        lat: clickedLngLat.value.lat.toString(),
        lng: clickedLngLat.value.lng.toString(),
      },
    })
  }
}

// Reverse geocode when context menu opens
watch([showContextMenu, clickedLngLat], async ([isOpen, lngLat]) => {
  if (isOpen && lngLat) {
    geocodedPlaceName.value = null
    geocodedAddress.value = null
    geocodedOsmId.value = null
    geocodedPlaceId.value = null
    isGeocoding.value = true

    try {
      const geocodingService = useGeocodingService()
      const result = await geocodingService.reverseGeocode({
        lat: lngLat.lat,
        lng: lngLat.lng,
        limit: 1,
      })

      if (result.results?.[0]) {
        const place = result.results[0]

        // Priority 1: Store OSM ID if available
        geocodedOsmId.value = place.externalIds?.osm || null

        // Priority 2: Store provider-specific place ID (e.g., Geoapify)
        if (
          !geocodedOsmId.value &&
          result.integration &&
          place.externalIds?.[result.integration]
        ) {
          geocodedPlaceId.value = {
            provider: result.integration,
            id: place.externalIds[result.integration],
          }
        }

        // Store place name and address separately
        geocodedPlaceName.value = place.name?.value || null
        geocodedAddress.value = formatAddress(place) || null
      }
    } catch (error) {
      console.error('Context menu geocoding failed:', error)
    } finally {
      isGeocoding.value = false
    }
  } else {
    geocodedPlaceName.value = null
    geocodedAddress.value = null
    geocodedOsmId.value = null
    geocodedPlaceId.value = null
    isGeocoding.value = false
  }
})

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

  // Show geocoded place name or address at top of menu - click to open place detail
  const displayLabel = geocodedPlaceName.value || geocodedAddress.value

  if (displayLabel) {
    items.push({
      type: 'item',
      id: 'open-place',
      label: displayLabel,
      icon: MapPinIcon,
      onSelect: openPlaceAtLocation,
    })
    items.push({ type: 'separator' })
  } else if (isGeocoding.value) {
    items.push({
      type: 'custom',
      id: 'geocoding-loader',
      component: h(
        'div',
        {
          class:
            'flex items-center gap-3 px-2 py-1.5 text-sm cursor-not-allowed',
        },
        [
          // Icon
          h(MapPinIcon, {
            class: 'h-4 w-4 shrink-0 text-muted-foreground',
          }),
          // Skeleton loader - h-5 matches text-sm line-height (1.25rem/20px)
          h(Skeleton, {
            class: 'h-5 flex-1',
          }),
        ],
      ),
    })
    items.push({ type: 'separator' })
  }

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

  // Add note
  items.push({
    type: 'item',
    id: 'add-note',
    label: t('notes.addNote'),
    icon: MessageSquarePlusIcon,
    onSelect: () => {
      if (!clickedLngLat.value) return
      router.push({
        name: AppRoute.NOTE_CREATE,
        query: {
          lat: clickedLngLat.value.lat.toString(),
          lng: clickedLngLat.value.lng.toString(),
        },
      })
    },
  })

  const measureDistanceOnSelect = () => {
    const lngLat = clickedLngLat.value
    const point = clickedPoint.value
    if (!lngLat || !point) return
    const project = (ll: LngLat) => mapService.project(ll)
    const click = { lngLat, point }
    if (mapToolsStore.activeTool !== 'measure') {
      mapToolsStore.setActiveTool('measure')
      mapToolsStore.pushMeasureState([lngLat])
      return
    }
    const points = mapToolsStore.measurePoints
    if (!project(lngLat)) {
      mapToolsStore.pushMeasureState([...points, lngLat])
      return
    }
    if (mapToolsStore.isMeasureClosed) {
      const insert = findSegmentToInsert(
        points,
        click,
        project,
        INSERT_THRESHOLD_PX,
      )
      if (insert) {
        const startPx = project(points[insert.segmentIndex])
        const endPx = project(points[insert.segmentIndex + 1])
        const insertPx = project(insert.point)
        const nearStart =
          startPx && insertPx && distancePx(insertPx, startPx) < VERTEX_NEAR_PX
        const nearEnd =
          endPx && insertPx && distancePx(insertPx, endPx) < VERTEX_NEAR_PX
        if (!nearStart && !nearEnd) {
          const next = [...points]
          next.splice(insert.segmentIndex + 1, 0, insert.point)
          mapToolsStore.pushMeasureState(next)
        }
      }
      return
    }
    const insert = findSegmentToInsert(
      points,
      click,
      project,
      INSERT_THRESHOLD_PX,
    )
    if (insert) {
      const startPx = project(points[insert.segmentIndex])
      const endPx = project(points[insert.segmentIndex + 1])
      const insertPx = project(insert.point)
      const nearStart =
        startPx && insertPx && distancePx(insertPx, startPx) < VERTEX_NEAR_PX
      const nearEnd =
        endPx && insertPx && distancePx(insertPx, endPx) < VERTEX_NEAR_PX
      if (!nearStart && !nearEnd) {
        const next = [...points]
        next.splice(insert.segmentIndex + 1, 0, insert.point)
        mapToolsStore.pushMeasureState(next)
        return
      }
    }
    if (shouldCloseLoop(points, click, project, CLOSE_LOOP_THRESHOLD_PX)) {
      mapToolsStore.pushMeasureState([...points, { ...points[0] }])
      return
    }
    mapToolsStore.pushMeasureState([...points, lngLat])
  }

  const measureCircleOnSelect = () => {
    const lngLat = clickedLngLat.value
    if (!lngLat) return
    mapToolsStore.setActiveTool('radius')
    mapToolsStore.setRadiusCenter(lngLat)
  }

  items.push({
    type: 'submenu',
    id: 'measure',
    label: t('map.contextMenu.measure'),
    icon: RulerIcon,
    items: [
      {
        type: 'item',
        id: 'measure-distance',
        label:
          mapToolsStore.activeTool === 'measure'
            ? t('measure.addMeasurement')
            : t('measure.distance'),
        icon: RulerIcon,
        onSelect: measureDistanceOnSelect,
      },
      {
        type: 'item',
        id: 'measure-circle',
        label: t('measure.circle'),
        icon: CircleDotIcon,
        onSelect: measureCircleOnSelect,
      },
    ],
  })

  items.push({ type: 'separator' })

  // Copy location submenu
  if (clickedLngLat.value) {
    const coords = clickedLngLat.value
    const plusCode = encode({ latitude: coords.lat, longitude: coords.lng })

    const copyItems: MenuItemDefinition[] = [
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
    ]

    // Add place name copy option if available
    if (geocodedPlaceName.value) {
      copyItems.push({
        type: 'item',
        id: 'copy-place-name',
        label: geocodedPlaceName.value,
        onSelect: copyPlaceName,
      })
    }

    // Add address copy option if available (and different from place name)
    if (
      geocodedAddress.value &&
      geocodedAddress.value !== geocodedPlaceName.value
    ) {
      copyItems.push({
        type: 'item',
        id: 'copy-address',
        label: geocodedAddress.value,
        onSelect: copyAddress,
      })
    }

    items.push({
      type: 'submenu',
      id: 'copy-location',
      label: t('map.contextMenu.copyLocation'),
      icon: CopyIcon,
      items: copyItems,
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
