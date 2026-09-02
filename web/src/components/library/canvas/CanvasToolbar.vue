<script setup lang="ts">
/**
 * The drawing tools, floating over the map for as long as a canvas is open.
 *
 * Always available, never behind a menu: annotating is the thing you do most
 * on a canvas, and a tool you have to go and find is a tool you don't use. It
 * mirrors the shape of Felt's toolbar — a tool strip with the open-ended
 * shapes offering Done and Undo once you're mid-draw.
 *
 * What the armed tool can be *set* to comes in through the `options` slot —
 * see `CanvasToolOptions` — and sits under a divider in the same box, so the
 * two read as one control rather than two things floating over the map.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import ResponsiveDropdown from '@/components/responsive/ResponsiveDropdown.vue'
import {
  CheckIcon,
  CircleIcon,
  FolderIcon,
  FolderOpenIcon,
  LayersIcon,
  MapPinIcon,
  MinusIcon,
  MousePointer2Icon,
  PencilIcon,
  PentagonIcon,
  RedoIcon,
  SquareIcon,
  TimerIcon,
  UndoIcon,
  WaypointsIcon,
} from 'lucide-vue-next'
import type { AnnotationTool } from '@/types/canvas.types'

const props = defineProps<{
  tool: AnnotationTool | null
  canFinish: boolean
  canUndo: boolean
  vertexCount: number
  /** Whether the canvas itself has anything to step back to, or forward to. */
  canUndoEdit: boolean
  canRedoEdit: boolean
  /** False when nothing is configured that can plan a route. */
  canRoute: boolean
  /** The canvas's groups, flattened, for the destination picker. */
  groups: { id: string; name: string; depth: number }[]
  /** Which of them new marks are filed in. Null is the canvas itself. */
  groupId: string | null
}>()

const emit = defineEmits<{
  arm: [tool: AnnotationTool | null]
  'update:groupId': [id: string | null]
  finish: []
  undo: []
  undoEdit: []
  redoEdit: []
}>()

const { t } = useI18n()

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
  { id: 'isochrone', icon: TimerIcon, key: 'T', hint: 'isochrone' },
  { id: 'doodle', icon: PencilIcon, key: 'D', hint: 'doodle' },
]

function isDisabled(item: (typeof TOOLS)[number]) {
  // Both lean on the routing engine; neither works without one.
  return (item.id === 'route' || item.id === 'isochrone') && !props.canRoute
}

function toolTitle(item: (typeof TOOLS)[number]) {
  const name = `${t(`canvases.toolbar.tools.${item.id}`)} (${item.key})`
  if (isDisabled(item)) return t('canvases.toolbar.hints.routingUnavailable')
  return item.hint
    ? `${name} · ${t(`canvases.toolbar.hints.${item.hint}`)}`
    : name
}

/** Mid-draw only for the shapes that don't finish themselves. */
const isDrawing = computed(() => props.vertexCount > 0)

// ── Where new marks land ─────────────────────────────────────────────────────

const activeGroup = computed(() =>
  props.groups.find(group => group.id === props.groupId),
)

/**
 * The destination, named on the toolbar rather than only in the panel: you
 * draw with your eyes on the map, and a pin that quietly files itself
 * somewhere you can't see is how a canvas gets untidy.
 */
const destinationItems = computed(() => [
  { type: 'label' as const, label: t('canvases.groups.destination') },
  {
    type: 'item' as const,
    id: 'canvas',
    label: t('canvases.groups.canvas'),
    icon: LayersIcon,
    active: !activeGroup.value,
    onSelect: () => emit('update:groupId', null),
  },
  ...props.groups.map(group => ({
    type: 'item' as const,
    id: group.id,
    // Nesting reads as indentation; the menu has no depth of its own.
    label: '\u2003'.repeat(group.depth) + group.name,
    icon: FolderIcon,
    active: group.id === props.groupId,
    onSelect: () => emit('update:groupId', group.id),
  })),
])
</script>

<template>
  <div
    class="pointer-events-auto rounded-xl border bg-background/95 backdrop-blur-sm shadow-lg overflow-hidden"
  >
    <!-- Wraps rather than overflows: the box is rounded and clipped, so a
         strip too wide for a phone would lose its last buttons entirely. -->
    <div class="flex flex-wrap justify-center items-center gap-0.5 p-1">
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

      <!-- Where the next mark gets filed. Only worth showing once there is
           somewhere else for it to go. -->
      <template v-if="groups.length && !isDrawing">
        <Separator orientation="vertical" class="h-5 mx-0.5" />
        <ResponsiveDropdown
          :items="destinationItems"
          align="end"
          :title="t('canvases.groups.destination')"
        >
          <template #trigger>
            <Button
              variant="ghost"
              size="sm"
              class="h-8 gap-1.5 px-2 max-w-36"
              :class="activeGroup && 'text-primary'"
              :title="t('canvases.groups.destination')"
            >
              <component
                :is="activeGroup ? FolderOpenIcon : LayersIcon"
                class="size-4 shrink-0"
              />
              <!-- The bar is already tight on a phone; there the icon and its
                   colour carry it, and the menu names the destination. -->
              <span class="text-xs truncate hidden sm:inline">
                {{ activeGroup?.name ?? t('canvases.groups.canvas') }}
              </span>
            </Button>
          </template>
        </ResponsiveDropdown>
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

    <!-- What the armed tool is set to: the same box, under a divider, so
         the two read as one control rather than two things floating over
         the map. -->
    <div
      v-if="tool"
      class="border-t p-1 flex flex-wrap justify-center items-center gap-0.5"
    >
      <slot name="options" />
    </div>
  </div>
</template>
