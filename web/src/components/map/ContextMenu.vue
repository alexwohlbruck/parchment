<script setup lang="ts">
import {
  onMounted,
  onUnmounted,
  ref,
  computed,
  watch,
  h,
  type Component,
} from 'vue'
import { useRouter, type RouteLocationRaw } from 'vue-router'
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
import { useIsochroneStore } from '@/stores/isochrone.store'
import { useVehiclesStore } from '@/stores/vehicles.store'
import { VEHICLE_TYPE_LABELS } from '@/lib/vehicle-mode-mapping'
import type { VehicleType } from '@/types/multimodal.types'
import { encode } from 'pluscodes'
import type { MenuItemDefinition } from '@/components/responsive/ResponsiveDropdown.vue'
import BrandIcon from '@/components/ui/brand-icon/BrandIcon.vue'
import { useExternalLink } from '@/composables/useExternalLink'
import {
  externalMapUrl,
  mapEditorUrl,
  type ExternalMapService,
  type MapEditor,
} from '@/lib/external-map-links'
import { nextMeasurePoints } from '@/lib/measure-click'
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
  RadarIcon,
  CrosshairIcon,
  CarFrontIcon,
} from 'lucide-vue-next'
import ResponsiveDropdown from '@/components/responsive/ResponsiveDropdown.vue'
import { Skeleton } from '@/components/ui/skeleton'
import PlaceCategoryIcon from '@/components/place/PlaceCategoryIcon.vue'
import { formatAddress, getPlaceRouteFromExternalIds } from '@/lib/place.utils'
import type { Place } from '@/types/place.types'
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
const isochroneStore = useIsochroneStore()
const vehiclesStore = useVehiclesStore()
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
/** Route to the geocoded place's detail page, when its ids resolve to one. */
const geocodedRoute = ref<RouteLocationRaw | null>(null)
/** The reverse-geocoded place itself — kept for its resolved POI icon. */
const geocodedPlace = ref<Place | null>(null)
const isGeocoding = ref(false)

/**
 * The place's own POI icon, styled exactly as it is on the place detail
 * header, so the menu row reads as the place rather than a generic pin.
 */
const geocodedPlaceIcon = computed<Component>(() => {
  const place = geocodedPlace.value
  if (!place) return MapPinIcon
  return () => h(PlaceCategoryIcon, { place })
})

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

  // Priority 1: the geocoded place resolved to its own detail route
  if (geocodedRoute.value) {
    router.push(geocodedRoute.value)
  }
  // Priority 2: If we have a place name (but no ID), use name+coordinate lookup
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
  // Priority 3: No name or ID, use coordinate-only lookup
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

function openCoordinateDetail() {
  if (!clickedLngLat.value) return
  router.push({
    name: AppRoute.PLACE_COORDS,
    params: {
      lat: clickedLngLat.value.lat.toString(),
      lng: clickedLngLat.value.lng.toString(),
    },
  })
}

// Reverse geocode when context menu opens
watch([showContextMenu, clickedLngLat], async ([isOpen, lngLat]) => {
  if (isOpen && lngLat) {
    geocodedPlaceName.value = null
    geocodedAddress.value = null
    geocodedRoute.value = null
    geocodedPlace.value = null
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

        // Resolve the route from the place's own external ids. Keying off the
        // integration name instead would miss geocoder addresses: Barrelman
        // fronts Pelias, so an address comes back under `pelias` while the
        // integration reads `barrelman`, and the mismatch dropped it through to
        // a fuzzy name search. This is the same helper bookmarks and map dots
        // route on, so every surface resolves a place identically.
        geocodedRoute.value = getPlaceRouteFromExternalIds(place.externalIds)

        // Store place name and address separately
        geocodedPlaceName.value = place.name?.value || null
        geocodedAddress.value = formatAddress(place) || null
        geocodedPlace.value = place
      }
    } catch (error) {
      console.error('Context menu geocoding failed:', error)
    } finally {
      isGeocoding.value = false
    }
  } else {
    geocodedPlaceName.value = null
    geocodedAddress.value = null
    geocodedRoute.value = null
    geocodedPlace.value = null
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

function openMapEditor(editor: MapEditor) {
  if (!clickedLngLat.value) return
  openExternalLink(mapEditorUrl(editor, clickedLngLat.value), '_blank')
}

function openExternalMap(service: ExternalMapService) {
  if (!clickedLngLat.value) return
  openExternalLink(
    externalMapUrl(service, clickedLngLat.value, mapCamera.value.zoom),
    '_blank',
  )
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
      icon: geocodedPlaceIcon.value,
      onSelect: openPlaceAtLocation,
    })
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
  }

  if (clickedLngLat.value) {
    items.push({
      type: 'item',
      id: 'open-coords',
      label: `${clickedLngLat.value.lat.toFixed(5)}, ${clickedLngLat.value.lng.toFixed(5)}`,
      icon: CrosshairIcon,
      onSelect: openCoordinateDetail,
    })
  }

  items.push({ type: 'separator' })

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

  // Set vehicle location — only show when user has vehicles
  if (clickedLngLat.value && vehiclesStore.vehicles.length > 0) {
    const coords = clickedLngLat.value
    if (vehiclesStore.vehicles.length === 1) {
      // Single vehicle — direct action
      const v = vehiclesStore.vehicles[0]
      const label = v.name || VEHICLE_TYPE_LABELS[v.type as VehicleType] || v.type
      items.push({
        type: 'item',
        id: 'set-vehicle-location',
        label: `Set ${label} location here`,
        icon: CarFrontIcon,
        onSelect: () => {
          vehiclesStore.updateVehicleLocation(v.id, { lat: coords.lat, lng: coords.lng }, 'manual')
        },
      })
    } else {
      // Multiple vehicles — submenu
      items.push({
        type: 'submenu',
        id: 'set-vehicle-location',
        label: 'Set vehicle location here',
        icon: CarFrontIcon,
        items: vehiclesStore.vehicles.map((v) => ({
          type: 'item' as const,
          id: `set-vehicle-${v.id}`,
          label: v.name || VEHICLE_TYPE_LABELS[v.type as VehicleType] || v.type,
          onSelect: () => {
            vehiclesStore.updateVehicleLocation(v.id, { lat: coords.lat, lng: coords.lng }, 'manual')
          },
        })),
      })
    }
  }

  const measureDistanceOnSelect = () => {
    const lngLat = clickedLngLat.value
    const point = clickedPoint.value
    if (!lngLat || !point) return

    // First click starts a measurement rather than extending one.
    if (mapToolsStore.activeTool !== 'measure') {
      mapToolsStore.setActiveTool('measure')
      mapToolsStore.pushMeasureState([lngLat])
      return
    }

    const next = nextMeasurePoints(
      mapToolsStore.measurePoints,
      { lngLat, point },
      ll => mapService.project(ll),
      mapToolsStore.isMeasureClosed,
    )
    if (next) mapToolsStore.pushMeasureState(next)
  }

  const measureCircleOnSelect = () => {
    const lngLat = clickedLngLat.value
    if (!lngLat) return
    mapToolsStore.setActiveTool('radius')
    mapToolsStore.setRadiusCenter(lngLat)
  }

  const isochroneOnSelect = () => {
    const lngLat = clickedLngLat.value
    if (!lngLat) return
    // Activate first: switching tools clears the isochrone store, which would
    // otherwise throw away the origin we just set.
    mapToolsStore.setActiveTool('isochrone')
    isochroneStore.setOrigin(lngLat)
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
      {
        type: 'item',
        id: 'measure-isochrone',
        label: t('isochrone.title'),
        icon: RadarIcon,
        onSelect: isochroneOnSelect,
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
