<script setup lang="ts">
/**
 * The armed tool's own settings, on the toolbar's second row.
 *
 * Only what the tool in hand can actually do: a line has no fill, a pin has
 * no dash pattern, and a bar that offers them anyway is mostly greyed out.
 * `TOOL_STYLE_OPTIONS` is the one place that says which is which — the same
 * table that decides what a new mark is given and what a finished mark's
 * style editor offers.
 *
 * These are the settings for the *next* mark. Selecting a mark copies its
 * style up here, so "another one like that" is a click; changing something
 * here never reaches back and restyles what you already drew.
 *
 * Laid out in groups — paint, the marker itself, the stroke, the fill, and
 * how the tool behaves — with a divider between each. Colour opens every
 * tool's row, so a group only ever needs a divider in front of it.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { IconPicker } from '@/components/ui/icon-picker'
import { Spinner } from '@/components/ui/spinner'
import CanvasToolNumber from './CanvasToolNumber.vue'
import MarkerShapePicker from './MarkerShapePicker.vue'
import {
  BikeIcon,
  CarFrontIcon,
  FootprintsIcon,
  TrainIcon,
} from 'lucide-vue-next'
import { annotationStyle } from '@/lib/canvas-annotations'
import {
  hasStyleOption,
  type DrawStyle,
} from '@/lib/canvas-draw-style'
import { maxMinutesForMode } from '@/lib/isochrone.utils'
import { themeColorToHex } from '@/lib/utils'
import {
  ANNOTATION_STROKE_CAPS,
  ANNOTATION_STROKE_STYLES,
  type AnnotationStrokeStyle,
  type AnnotationTool,
} from '@/types/canvas.types'
import type { MarkerShape } from '@/lib/map-marker'
import type { RouteMode } from '@/types/routes.types'
import type { IsochroneMode } from '@server/types/isochrone.types'

const props = defineProps<{
  tool: AnnotationTool
  /** Only what has been set; the rest is drawn from the defaults. */
  style: DrawStyle
  /** Which network a route follows. Behaviour rather than style. */
  routeMode: RouteMode
  isochroneMode: IsochroneMode
  isochroneMinutes: number
  /** True while the routing engine is working. */
  isBusy?: boolean
}>()

const emit = defineEmits<{
  'update:style': [patch: DrawStyle]
  'update:routeMode': [mode: RouteMode]
  'update:isochroneMode': [mode: IsochroneMode]
  'update:isochroneMinutes': [minutes: number]
}>()

const { t } = useI18n()

/** What the next mark will actually be drawn as, defaults filled in. */
const style = computed(() => annotationStyle({ tool: props.tool, ...props.style }))
const color = computed(() => props.style.color ?? 'compass')
const has = (option: Parameters<typeof hasStyleOption>[1]) =>
  hasStyleOption(props.tool, option)

const percent = (value: number) => `${Math.round(value * 100)}%`

/** A dash pattern is shown as one, not named. */
const STROKE_DASHES: Record<AnnotationStrokeStyle, string> = {
  solid: '',
  dashed: '4 3',
  dotted: '1 3',
}

const ROUTE_MODES: { id: RouteMode; icon: typeof BikeIcon }[] = [
  { id: 'walking', icon: FootprintsIcon },
  { id: 'cycling', icon: BikeIcon },
  { id: 'driving', icon: CarFrontIcon },
]

const ISOCHRONE_MODES: {
  id: IsochroneMode
  icon: typeof BikeIcon
  label: string
}[] = [
  { id: 'walk', icon: FootprintsIcon, label: 'isochrone.modeWalk' },
  { id: 'bike', icon: BikeIcon, label: 'isochrone.modeBike' },
  { id: 'car', icon: CarFrontIcon, label: 'isochrone.modeCar' },
  { id: 'transit', icon: TrainIcon, label: 'isochrone.modeTransit' },
]

/** How far the engine will answer for, which depends on the mode. */
const maxMinutes = computed(() => maxMinutesForMode(props.isochroneMode))
</script>

<template>
  <div class="contents">
    <!-- Colour, and for a pin its glyph too: one picker, since a pin is both. -->
    <IconPicker
      compact
      allow-custom-color
      :color-only="!has('icon')"
      :label="
        has('icon')
          ? t('canvases.annotations.icon')
          : t('canvases.annotations.color')
      "
      :model-value="{
        icon: props.style.icon ?? (has('icon') ? 'MapPin' : ''),
        color,
      }"
      @update:model-value="
        value =>
          emit('update:style', {
            color: value.color,
            ...(has('icon') ? { icon: value.icon } : {}),
          })
      "
    />

    <!-- The marker itself: what shape the plate is, and how big. -->
    <Separator v-if="has('markerShape')" orientation="vertical" class="h-5 mx-0.5" />

    <MarkerShapePicker
      v-if="has('markerShape')"
      :model-value="style.markerShape"
      :color="color"
      @update:model-value="shape => emit('update:style', { markerShape: shape as MarkerShape })"
    />

    <CanvasToolNumber
      v-if="has('markerSize')"
      :label="t('canvases.annotations.markerSize')"
      :model-value="style.markerSize"
      :min="4"
      :max="20"
      :step="0.5"
      @update:model-value="markerSize => emit('update:style', { markerSize })"
    >
      <template #glyph>
        <span
          class="rounded-full border-[1.5px] border-current"
          :style="{
            width: `${Math.min(style.markerSize, 14)}px`,
            height: `${Math.min(style.markerSize, 14)}px`,
          }"
        />
      </template>
    </CanvasToolNumber>

    <!-- The stroke: how thick, how broken, how it ends, how solid. -->
    <Separator v-if="has('strokeWidth')" orientation="vertical" class="h-5 mx-0.5" />

    <CanvasToolNumber
      v-if="has('strokeWidth')"
      :label="t('canvases.annotations.strokeWidth')"
      :model-value="style.strokeWidth"
      :min="1"
      :max="24"
      :step="1"
      @update:model-value="strokeWidth => emit('update:style', { strokeWidth })"
    >
      <template #glyph>
        <span
          class="w-4 rounded-full bg-current"
          :style="{ height: `${Math.min(style.strokeWidth, 10)}px` }"
        />
      </template>
    </CanvasToolNumber>

    <span v-if="has('strokeStyle')" class="flex items-center gap-0.5">
      <button
        v-for="option in ANNOTATION_STROKE_STYLES"
        :key="option"
        type="button"
        class="size-8 rounded-md flex items-center justify-center transition-colors hover:bg-accent"
        :class="style.strokeStyle === option && 'bg-accent'"
        :title="t(`canvases.annotations.strokeStyles.${option}`)"
        :aria-label="t(`canvases.annotations.strokeStyles.${option}`)"
        :aria-pressed="style.strokeStyle === option"
        @click="emit('update:style', { strokeStyle: option })"
      >
        <svg width="18" height="2" viewBox="0 0 18 2" aria-hidden="true">
          <line
            x1="0"
            y1="1"
            x2="18"
            y2="1"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            :stroke-dasharray="STROKE_DASHES[option] || undefined"
          />
        </svg>
      </button>
    </span>

    <span v-if="has('strokeCap')" class="flex items-center gap-0.5">
      <button
        v-for="option in ANNOTATION_STROKE_CAPS"
        :key="option"
        type="button"
        class="size-8 rounded-md flex items-center justify-center transition-colors hover:bg-accent"
        :class="style.strokeCap === option && 'bg-accent'"
        :title="t(`canvases.annotations.strokeCaps.${option}`)"
        :aria-label="t(`canvases.annotations.strokeCaps.${option}`)"
        :aria-pressed="style.strokeCap === option"
        @click="emit('update:style', { strokeCap: option })"
      >
        <!-- Drawn thick and short so the end itself is what you see. -->
        <svg width="18" height="8" viewBox="0 0 18 8" aria-hidden="true">
          <line
            x1="5"
            y1="4"
            x2="13"
            y2="4"
            stroke="currentColor"
            stroke-width="6"
            :stroke-linecap="option"
          />
        </svg>
      </button>
    </span>

    <CanvasToolNumber
      v-if="has('strokeOpacity')"
      :label="t('canvases.annotations.strokeOpacity')"
      :model-value="style.strokeOpacity * 100"
      :display="percent(style.strokeOpacity)"
      :min="0"
      :max="100"
      :step="5"
      @update:model-value="
        value => emit('update:style', { strokeOpacity: value / 100 })
      "
    >
      <template #glyph>
        <span
          class="size-3 rounded-full"
          :style="{
            backgroundColor: themeColorToHex(color),
            opacity: style.strokeOpacity,
          }"
        />
      </template>
    </CanvasToolNumber>

    <template v-if="has('fillColor')">
      <Separator orientation="vertical" class="h-5 mx-0.5" />
      <IconPicker
        compact
        color-only
        allow-custom-color
        :label="t('canvases.annotations.fillColor')"
        :model-value="{ icon: '', color: props.style.fillColor ?? color }"
        @update:model-value="
          value => emit('update:style', { fillColor: value.color })
        "
      />
      <CanvasToolNumber
        :label="t('canvases.annotations.fillOpacity')"
        :model-value="style.fillOpacity * 100"
        :display="percent(style.fillOpacity)"
        :min="0"
        :max="100"
        :step="5"
        @update:model-value="
          value => emit('update:style', { fillOpacity: value / 100 })
        "
      >
        <template #glyph>
          <span
            class="size-3 rounded-[3px]"
            :style="{
              backgroundColor: themeColorToHex(props.style.fillColor ?? color),
              opacity: style.fillOpacity,
            }"
          />
        </template>
      </CanvasToolNumber>
    </template>

    <!-- How the tool behaves, rather than how the mark looks: which network
         a route follows, and how far a reachable area reaches. -->
    <template v-if="tool === 'route'">
      <Separator orientation="vertical" class="h-5 mx-0.5" />
      <Button
        v-for="mode in ROUTE_MODES"
        :key="mode.id"
        variant="ghost"
        size="icon"
        class="size-8"
        :class="routeMode === mode.id && 'bg-secondary text-foreground'"
        :title="t(`directions.modes.${mode.id}`)"
        :aria-label="t(`directions.modes.${mode.id}`)"
        @click="emit('update:routeMode', mode.id)"
      >
        <component :is="mode.icon" class="size-4" />
      </Button>
    </template>

    <template v-if="tool === 'isochrone'">
      <Separator orientation="vertical" class="h-5 mx-0.5" />
      <Button
        v-for="mode in ISOCHRONE_MODES"
        :key="mode.id"
        variant="ghost"
        size="icon"
        class="size-8"
        :class="isochroneMode === mode.id && 'bg-secondary text-foreground'"
        :title="t(mode.label)"
        :aria-label="t(mode.label)"
        @click="emit('update:isochroneMode', mode.id)"
      >
        <component :is="mode.icon" class="size-4" />
      </Button>
      <CanvasToolNumber
        :label="t('isochrone.reach')"
        :model-value="isochroneMinutes"
        :display="t('isochrone.minutes', { count: isochroneMinutes })"
        :min="5"
        :max="maxMinutes"
        :step="5"
        @update:model-value="value => emit('update:isochroneMinutes', value)"
      />
    </template>

    <!-- Always here, so the row keeps its width while the engine works. -->
    <Spinner
      class="size-3.5 mx-1 text-muted-foreground"
      :class="!isBusy && 'invisible'"
      :aria-hidden="!isBusy"
    />
  </div>
</template>
