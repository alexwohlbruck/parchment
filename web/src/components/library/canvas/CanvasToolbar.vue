<script setup lang="ts">
/**
 * The drawing tools, floating over the map for as long as a canvas is open.
 *
 * Always available, never behind a menu: annotating is the thing you do most
 * on a canvas, and a tool you have to go and find is a tool you don't use. It
 * mirrors the shape of Felt's toolbar — a tool strip with the open-ended
 * shapes offering Done and Undo once you're mid-draw.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ColorPicker } from '@/components/ui/color-picker'
import {
  BikeIcon,
  CarFrontIcon,
  CheckIcon,
  CircleIcon,
  FootprintsIcon,
  MapPinIcon,
  MinusIcon,
  MousePointer2Icon,
  PentagonIcon,
  RadiusIcon,
  RedoIcon,
  RulerIcon,
  SquareIcon,
  TimerIcon,
  Wand2Icon,
  UndoIcon,
  WaypointsIcon,
} from 'lucide-vue-next'
import { Spinner } from '@/components/ui/spinner'
import ResponsiveDropdown from '@/components/responsive/ResponsiveDropdown.vue'
import { useMapToolsStore } from '@/stores/map-tools.store'
import type { AnnotationTool } from '@/types/canvas.types'
import type { RouteMode } from '@/types/routes.types'

const props = defineProps<{
  tool: AnnotationTool | null
  color: string
  canFinish: boolean
  canUndo: boolean
  vertexCount: number
  /** Travel mode the Route tool snaps with. */
  routeMode: RouteMode
  /** True while the routing engine is working. */
  isSnapping?: boolean
  /** Whether the canvas itself has anything to step back to, or forward to. */
  canUndoEdit: boolean
  canRedoEdit: boolean
  /** False when nothing is configured that can plan a route. */
  canRoute: boolean
}>()

const emit = defineEmits<{
  arm: [tool: AnnotationTool | null]
  'update:color': [color: string]
  'update:routeMode': [mode: RouteMode]
  finish: []
  undo: []
  undoEdit: []
  redoEdit: []
}>()

const { t } = useI18n()
const mapToolsStore = useMapToolsStore()

/**
 * The map's own tools, offered from here too.
 *
 * Measuring, ringing a radius and drawing an isochrone are the same jobs on a
 * canvas as on the map, and they already exist — so this arms the map tool
 * rather than growing a second copy of each inside the canvas editor.
 */
const advancedTools = computed(() => [
  {
    type: 'item' as const,
    id: 'measure',
    label: t('mapTools.measure'),
    icon: RulerIcon,
    onSelect: () => arm('measure'),
  },
  {
    type: 'item' as const,
    id: 'radius',
    label: t('mapTools.radius'),
    icon: RadiusIcon,
    onSelect: () => arm('radius'),
  },
  {
    type: 'item' as const,
    id: 'isochrone',
    label: t('mapTools.isochrone'),
    icon: TimerIcon,
    onSelect: () => arm('isochrone'),
  },
])

/** Arming a map tool drops the drawing tool: both want the map's clicks. */
function arm(tool: 'measure' | 'radius' | 'isochrone') {
  emit('arm', null)
  mapToolsStore.setActiveTool(
    mapToolsStore.activeTool === tool ? 'none' : tool,
  )
}

/**
 * Each tool's glyph and its single-key shortcut, Felt-style. A hint carries
 * what the tool can do beyond clicking — held keys and the like — where it
 * can be found without taking up room on the bar.
 */
const TOOLS: {
  id: AnnotationTool
  icon: typeof MapPinIcon
  key: string
  hint?: string
}[] = [
  { id: 'pin', icon: MapPinIcon, key: 'P' },
  { id: 'line', icon: MinusIcon, key: 'L', hint: 'straight' },
  { id: 'route', icon: WaypointsIcon, key: 'R' },
  { id: 'polygon', icon: PentagonIcon, key: 'O', hint: 'close' },
  { id: 'rectangle', icon: SquareIcon, key: 'E', hint: 'square' },
  { id: 'circle', icon: CircleIcon, key: 'I', hint: 'radius' },
]

function isDisabled(item: (typeof TOOLS)[number]) {
  return item.id === 'route' && !props.canRoute
}

function toolTitle(item: (typeof TOOLS)[number]) {
  const name = `${t(`canvases.toolbar.tools.${item.id}`)} (${item.key})`
  if (isDisabled(item)) return t('canvases.toolbar.hints.routeUnavailable')
  return item.hint
    ? `${name} · ${t(`canvases.toolbar.hints.${item.hint}`)}`
    : name
}

/** Travel modes the Route tool can snap with. */
const ROUTE_MODES: { id: RouteMode; icon: typeof BikeIcon }[] = [
  { id: 'walking', icon: FootprintsIcon },
  { id: 'cycling', icon: BikeIcon },
  { id: 'driving', icon: CarFrontIcon },
]

/** Mid-draw only for the shapes that don't finish themselves. */
const isDrawing = computed(() => props.vertexCount > 0)
</script>

<template>
  <div
    class="pointer-events-auto flex items-center gap-0.5 rounded-xl border bg-background/95 backdrop-blur-sm p-1 shadow-lg"
  >
    <Button
      variant="ghost"
      size="icon"
      class="size-8"
      :class="!tool && 'bg-secondary text-foreground'"
      :title="t('canvases.toolbar.select')"
      :aria-label="t('canvases.toolbar.select')"
      @click="emit('arm', null)"
    >
      <MousePointer2Icon class="size-4" />
    </Button>

    <Separator orientation="vertical" class="h-5 mx-0.5" />

    <Button
      v-for="item in TOOLS"
      :key="item.id"
      variant="ghost"
      size="icon"
      class="size-8"
      :class="tool === item.id && 'bg-secondary text-foreground'"
      :disabled="isDisabled(item)"
      :title="toolTitle(item)"
      :aria-label="t(`canvases.toolbar.tools.${item.id}`)"
      @click="emit('arm', item.id)"
    >
      <component :is="item.icon" class="size-4" />
    </Button>

    <Separator orientation="vertical" class="h-5 mx-0.5" />
    <ResponsiveDropdown :items="advancedTools" align="start">
      <template #trigger>
        <Button
          variant="ghost"
          size="icon"
          class="size-8"
          :class="
            mapToolsStore.activeTool !== 'none' &&
            'bg-secondary text-foreground'
          "
          :title="t('canvases.toolbar.advanced')"
          :aria-label="t('canvases.toolbar.advanced')"
        >
          <Wand2Icon class="size-4" />
        </Button>
      </template>
    </ResponsiveDropdown>

    <!-- Which network the route follows. Only meaningful for that tool. -->
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
      <Spinner v-if="isSnapping" class="size-3.5 mx-1 text-muted-foreground" />
    </template>

    <template v-if="tool">
      <Separator orientation="vertical" class="h-5 mx-0.5" />
      <ColorPicker
        :model-value="color"
        @update:model-value="value => emit('update:color', value)"
      />
    </template>

    <!-- Stepping the canvas itself back and forth. Hidden mid-draw, where
         Undo means the last point rather than the last thing done. -->
    <template v-if="!isDrawing">
      <Separator orientation="vertical" class="h-5 mx-0.5" />
      <Button
        variant="ghost"
        size="icon"
        class="size-8"
        :disabled="!canUndoEdit"
        :title="`${t('canvases.toolbar.undoEdit')} (⌘Z)`"
        :aria-label="t('canvases.toolbar.undoEdit')"
        @click="emit('undoEdit')"
      >
        <UndoIcon class="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        class="size-8"
        :disabled="!canRedoEdit"
        :title="`${t('canvases.toolbar.redoEdit')} (⌘⇧Z)`"
        :aria-label="t('canvases.toolbar.redoEdit')"
        @click="emit('redoEdit')"
      >
        <RedoIcon class="size-4" />
      </Button>
    </template>

    <!-- Only the open-ended shapes need finishing; a pin or a circle is done
         the moment it has its positions. -->
    <template v-if="isDrawing">
      <Separator orientation="vertical" class="h-5 mx-0.5" />
      <Button
        variant="ghost"
        size="icon"
        class="size-8"
        :disabled="!canUndo"
        :title="t('canvases.toolbar.undo')"
        :aria-label="t('canvases.toolbar.undo')"
        @click="emit('undo')"
      >
        <UndoIcon class="size-4" />
      </Button>
      <Button
        size="sm"
        class="h-8 px-2.5"
        :disabled="!canFinish"
        @click="emit('finish')"
      >
        <CheckIcon class="size-3.5" />
        {{ t('general.done') }}
      </Button>
    </template>
  </div>
</template>
