<script setup lang="ts">
/**
 * Isochrone tool.
 *
 * Drops an origin on the map and paints the area reachable from it within a
 * set of time budgets. The contours come from Barrelman (GraphHopper for
 * street modes, MOTIS + walking egress for transit) via the authenticated
 * `/isochrone` endpoint; everything here is presentation.
 *
 * Layer handling mirrors its sibling measure tools: sources and layers are
 * added while the tool is active, torn down when it isn't, and re-added on
 * `style.load` because a basemap swap drops them.
 */

import {
  computed,
  onMounted,
  onUnmounted,
  ref,
  watch,
  type Component,
} from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import {
  BikeIcon,
  CarFrontIcon,
  FootprintsIcon,
  RotateCwIcon,
  TrainIcon,
} from 'lucide-vue-next'
import type { IsochroneMode } from '@server/types/isochrone.types'
import { useMapService } from '@/services/map/map.service'
import { useMapToolsStore } from '@/stores/map-tools.store'
import { useIsochroneStore } from '@/stores/isochrone.store'
import { useAppStore } from '@/stores/app.store'
import { mapEventBus } from '@/lib/event-bus'
import { useHotkeys } from '@/composables/useHotkeys'
import { useAreaLayer } from '@/composables/map/useAreaLayer'
import { formatMeasureArea } from '@/lib/measure/measure'
import type { UnitSystem as MeasureUnitSystem } from '@/lib/measure/measure'
import { UnitSystem } from '@/types/map.types'
import type { LngLat } from '@/types/map.types'
import {
  BAND_COUNTS,
  CONTOUR_MINUTE_STEP,
  MIN_CONTOUR_MINUTES,
  bandsToGeoJson,
  maxMinutesForMode,
} from '@/lib/directions/isochrone'
import { isochroneAnnotations } from '@/lib/canvas/measurement-annotations'
import {
  EMPTY_ISOCHRONE_GEOJSON,
  ISOCHRONE_FILL_LAYER_ID,
  ISOCHRONE_LINE_LAYER_ID,
  ISOCHRONE_SOURCE_ID,
} from '@/constants/layers'
import MeasureDot from './MeasureDot.vue'
import MeasureExportActions from './MeasureExportActions.vue'
import MeasureToolPanel from './MeasureToolPanel.vue'
import UnitSystemToggle from './UnitSystemToggle.vue'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Spinner } from '@/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

const ORIGIN_MARKER_ID = 'isochrone-origin-dot'

const MODES: Array<{ id: IsochroneMode; icon: Component; labelKey: string }> = [
  { id: 'walk', icon: FootprintsIcon, labelKey: 'isochrone.modeWalk' },
  { id: 'bike', icon: BikeIcon, labelKey: 'isochrone.modeBike' },
  { id: 'car', icon: CarFrontIcon, labelKey: 'isochrone.modeCar' },
  { id: 'transit', icon: TrainIcon, labelKey: 'isochrone.modeTransit' },
]

const mapService = useMapService()
const mapToolsStore = useMapToolsStore()
const isochroneStore = useIsochroneStore()
const appStore = useAppStore()
const { t, locale } = useI18n()

const { unitSystem } = storeToRefs(appStore)
const {
  origin,
  mode,
  maxMinutes,
  bandCount,
  arriveBy,
  bands,
  meta,
  status,
  error,
} = storeToRefs(isochroneStore)

const isActive = computed(() => mapToolsStore.activeTool === 'isochrone')

/** Skip marker re-sync mid-drag so we don't remove the marker being dragged. */
const isDraggingOrigin = ref(false)

const areaUnitSystem = ref<MeasureUnitSystem>(
  unitSystem.value === UnitSystem.IMPERIAL ? 'imperial' : 'metric',
)

watch(isActive, active => {
  if (active) {
    areaUnitSystem.value =
      unitSystem.value === UnitSystem.IMPERIAL ? 'imperial' : 'metric'
  }
})

const reachMarks = computed(() =>
  isochroneAnnotations(origin.value, bands.value, mode.value, minutes =>
    t('isochrone.minutes', { count: minutes }),
  ),
)

const sliderMax = computed(() => maxMinutesForMode(mode.value))

function formatArea(squareMeters: number): string {
  return formatMeasureArea(squareMeters, areaUnitSystem.value, locale.value)
}

/** Transit contours are shaped by the stops MOTIS found; worth surfacing. */
const reachableStops = computed(() =>
  mode.value === 'transit' ? (meta.value?.reachableStops ?? null) : null,
)

const errorMessage = computed(() => {
  if (status.value !== 'error') return null
  return error.value === 'unreachable'
    ? t('isochrone.unreachable')
    : (error.value ?? t('isochrone.errorGeneric'))
})

// ── Map layers ──────────────────────────────────────────────────────

const { color: bandColor } = useAreaLayer(
  {
    source: ISOCHRONE_SOURCE_ID,
    fill: ISOCHRONE_FILL_LAYER_ID,
    line: ISOCHRONE_LINE_LAYER_ID,
  },
  () => isActive.value,
  () => (bands.value.length ? bandsToGeoJson(bands.value) : EMPTY_ISOCHRONE_GEOJSON),
)

// ── Origin marker ───────────────────────────────────────────────────

function removeOriginMarker() {
  mapService.removeMarker?.(ORIGIN_MARKER_ID)
}

function syncOriginMarker() {
  removeOriginMarker()
  const point = origin.value
  if (!point) return
  mapService.addVueMarker(
    ORIGIN_MARKER_ID,
    point,
    MeasureDot,
    { index: 0, isFirst: true, onRemove: () => isochroneStore.setOrigin(null) },
    undefined,
    {
      onDrag: () => {
        isDraggingOrigin.value = true
      },
      onDragEnd: (lngLat: LngLat) => {
        isDraggingOrigin.value = false
        // Only on drag *end* — every intermediate position would be its own
        // round trip through GraphHopper.
        isochroneStore.setOrigin(lngLat)
      },
    },
  )
}

// ── Map click ───────────────────────────────────────────────────────

let clickHandler: ((data: { lngLat: LngLat }) => void) | null = null

function setupClickOverride() {
  if (clickHandler) return
  clickHandler = (data: { lngLat: LngLat }) =>
    isochroneStore.setOrigin(data.lngLat)
  mapEventBus.setOverride('click', clickHandler)
}

function teardownClickOverride() {
  if (!clickHandler) return
  mapEventBus.removeOverride('click', clickHandler)
  clickHandler = null
}

// ── Lifecycle ───────────────────────────────────────────────────────

function activate() {
  setupClickOverride()
  syncOriginMarker()
}

function deactivate() {
  teardownClickOverride()
  removeOriginMarker()
}

useHotkeys([
  {
    key: ['escape'],
    handler: () => {
      if (isActive.value) closeTool()
    },
    id: 'isochrone-close',
    category: 'tools',
    name: 'Close isochrone tool',
    description: 'Close the isochrone tool',
  },
])

watch(isActive, active => (active ? activate() : deactivate()), {
  immediate: true,
})

watch(origin, () => {
  // Re-placing the marker mid-drag would yank it out from under the cursor.
  if (isActive.value && !isDraggingOrigin.value) syncOriginMarker()
})

/** A basemap swap drops the origin marker too, so put it back. */
function handleStyleLoad() {
  if (isActive.value) syncOriginMarker()
}

mapEventBus.on('style.load', handleStyleLoad)

onMounted(() => {
  if (isActive.value) activate()
})

onUnmounted(() => {
  // The tool is unmounted whenever another one takes over, so the style
  // listener has to come off with it or it stacks up across switches.
  mapEventBus.off('style.load', handleStyleLoad)
  deactivate()
})

function closeTool() {
  mapToolsStore.setActiveTool('none')
}
</script>

<template>
  <MeasureToolPanel
    v-if="isActive"
    :title="t('isochrone.title')"
    :close-label="t('isochrone.close')"
    width-class="w-[19rem]"
    @close="closeTool"
  >
    <template #header-actions>
      <UnitSystemToggle v-model="areaUnitSystem" />
    </template>
    <template #title-adornment>
      <Spinner
        v-if="status === 'loading'"
        size="icon"
        class="text-muted-foreground"
      />
    </template>

        <!-- Travel mode -->
        <ToggleGroup
          type="single"
          :model-value="mode"
          class="grid grid-cols-4 gap-1"
          @update:model-value="
            value => value && isochroneStore.setMode(value as IsochroneMode)
          "
        >
          <ToggleGroupItem
            v-for="option in MODES"
            :key="option.id"
            :value="option.id"
            variant="outline"
            :aria-label="t(option.labelKey)"
            class="h-8 w-full max-md:h-10 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
          >
            <component :is="option.icon" class="size-4 shrink-0" />
          </ToggleGroupItem>
        </ToggleGroup>

        <!-- Direction -->
        <ToggleGroup
          type="single"
          :model-value="arriveBy ? 'to' : 'from'"
          class="grid grid-cols-2 gap-1"
          @update:model-value="
            value => value && isochroneStore.setArriveBy(value === 'to')
          "
        >
          <ToggleGroupItem
            v-for="direction in ['from', 'to'] as const"
            :key="direction"
            :value="direction"
            variant="outline"
            class="h-7 w-full text-[12px] max-md:h-9 max-md:text-[13px] data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
          >
            {{ t(direction === 'from' ? 'isochrone.fromHere' : 'isochrone.toHere') }}
          </ToggleGroupItem>
        </ToggleGroup>

        <!-- Reach -->
        <div class="flex flex-col gap-1.5">
          <div class="flex items-baseline justify-between gap-4">
            <Label
              class="shrink-0 text-[11px] font-medium text-muted-foreground"
            >
              {{ t('isochrone.reach') }}
            </Label>
            <span
              class="text-[13px] font-medium tracking-[-0.02em] text-foreground tabular-nums"
            >
              {{ t('isochrone.minutes', { count: maxMinutes }) }}
            </span>
          </div>
          <Slider
            :model-value="[maxMinutes]"
            :min="MIN_CONTOUR_MINUTES"
            :max="sliderMax"
            :step="CONTOUR_MINUTE_STEP"
            :aria-label="t('isochrone.reach')"
            @update:model-value="
              value =>
                value?.[0] != null && isochroneStore.setMaxMinutes(value[0])
            "
          />
        </div>

        <!-- Band count -->
        <div class="flex items-center justify-between gap-4">
          <Label class="shrink-0 text-[11px] font-medium text-muted-foreground">
            {{ t('isochrone.bands') }}
          </Label>
          <ToggleGroup
            type="single"
            :model-value="String(bandCount)"
            class="gap-1"
            @update:model-value="
              value => value && isochroneStore.setBandCount(Number(value))
            "
          >
            <ToggleGroupItem
              v-for="count in BAND_COUNTS"
              :key="count"
              :value="String(count)"
              variant="outline"
              :aria-label="t('isochrone.bandsCount', { count })"
              class="h-7 w-8 text-[12px] tabular-nums max-md:h-9 max-md:w-10 max-md:text-[13px] data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              {{ count }}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>


        <Separator />

        <!-- Results. Kept on screen while a new request is in flight — the map
             still shows these contours, and blanking the legend on every
             slider nudge is more disorienting than a moment of staleness. -->
        <template v-if="bands.length">
          <div
            class="grid grid-cols-3 gap-x-3 gap-y-2.5 transition-opacity"
            :class="{ 'opacity-50': status === 'loading' }"
          >
            <div
              v-for="band in bands"
              :key="band.bucket"
              class="flex min-w-0 flex-col gap-0.5"
            >
              <span class="flex min-w-0 items-center gap-2">
                <span
                  class="size-3 shrink-0 rounded-[3px] ring-1 ring-inset ring-border/60"
                  :style="{ backgroundColor: bandColor, opacity: band.opacity }"
                  aria-hidden
                />
                <Label class="text-[11px] font-medium text-muted-foreground">
                  {{
                    t('isochrone.minutes', {
                      count: Math.round(band.durationMinutes),
                    })
                  }}
                </Label>
              </span>
              <span
                class="truncate text-[13px] font-medium tracking-[-0.02em] text-foreground tabular-nums"
              >
                {{ formatArea(band.reachableAreaSquareMeters) }}
              </span>
            </div>
          </div>

          <p
            v-if="reachableStops"
            class="m-0 text-[11px] leading-[1.4] text-muted-foreground"
          >
            {{ t('isochrone.stopsReachable', { count: reachableStops }) }}
          </p>

          <MeasureExportActions
            :annotations="reachMarks"
            :name="t('isochrone.title')"
          />
        </template>

        <!-- Error -->
        <div v-else-if="status === 'error'" class="flex flex-col gap-2">
          <p class="m-0 text-[13px] leading-[1.4] text-muted-foreground">
            {{ errorMessage }}
          </p>
          <Button
            variant="outline"
            size="sm"
            class="h-7 self-start"
            @click="isochroneStore.retry()"
          >
            <RotateCwIcon class="mr-1.5 size-3.5" />
            {{ t('isochrone.retry') }}
          </Button>
        </div>

        <!-- Loading / empty -->
        <p v-else class="m-0 text-[13px] leading-[1.4] text-muted-foreground">
          {{
            status === 'loading' ? t('isochrone.loading') : t('isochrone.empty')
          }}
        </p>
  </MeasureToolPanel>
</template>
