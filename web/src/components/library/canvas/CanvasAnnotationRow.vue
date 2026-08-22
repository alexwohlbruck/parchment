<script setup lang="ts">
/**
 * One annotation in the canvas panel, expanding into its own properties.
 *
 * Marks are made fast and named later — often much later — so everything
 * about one stays editable: what it's called, what colour it is, and for a
 * pin, the glyph inside it. Editing happens in place rather than in a dialog,
 * because you are looking at the map while you do it.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { IconPicker } from '@/components/ui/icon-picker'
import {
  ChevronRightIcon,
  CircleIcon,
  MapPinIcon,
  MinusIcon,
  PentagonIcon,
  SquareIcon,
  Trash2Icon,
  WaypointsIcon,
} from 'lucide-vue-next'
import {
  ANNOTATION_COLORS,
  DEFAULT_ANNOTATION_COLOR,
} from '@/lib/canvas-annotations'
import type { AnnotationTool, CanvasAnnotation } from '@/types/canvas.types'

const props = defineProps<{
  annotation: CanvasAnnotation
  expanded?: boolean
}>()

const emit = defineEmits<{
  update: [patch: Partial<CanvasAnnotation>]
  remove: []
  toggleExpanded: []
}>()

const { t } = useI18n()

const TOOL_ICONS: Record<AnnotationTool, typeof MapPinIcon> = {
  pin: MapPinIcon,
  line: MinusIcon,
  route: WaypointsIcon,
  polygon: PentagonIcon,
  rectangle: SquareIcon,
  circle: CircleIcon,
}

const color = computed(
  () => props.annotation.color ?? DEFAULT_ANNOTATION_COLOR,
)

const label = ref(props.annotation.label ?? '')

function commitLabel() {
  const next = label.value.trim()
  if (next !== (props.annotation.label ?? '')) {
    emit('update', { label: next || undefined })
  }
}

const fallbackName = computed(() =>
  t(`canvases.toolbar.tools.${props.annotation.tool}`),
)
</script>

<template>
  <div class="rounded-lg border bg-card overflow-hidden">
    <div class="flex items-center gap-2 px-2 py-1.5">
      <button
        class="flex items-center gap-2 min-w-0 flex-1 text-left"
        :aria-expanded="expanded"
        @click="emit('toggleExpanded')"
      >
        <ChevronRightIcon
          class="size-3 shrink-0 text-muted-foreground transition-transform duration-150"
          :class="expanded && 'rotate-90'"
        />
        <span
          class="size-4 shrink-0 rounded-full flex items-center justify-center"
          :style="{ background: color }"
        >
          <component
            :is="TOOL_ICONS[annotation.tool]"
            class="size-2.5 text-white"
          />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block text-sm truncate">
            {{ annotation.label || fallbackName }}
          </span>
          <span
            v-if="annotation.routed"
            class="block text-[11px] text-muted-foreground"
          >
            {{ t(`directions.modes.${annotation.routed.mode}`) }}
          </span>
        </span>
      </button>

      <Button
        variant="ghost"
        size="icon"
        class="size-7 shrink-0"
        :title="t('canvases.annotations.remove')"
        :aria-label="t('canvases.annotations.remove')"
        @click="emit('remove')"
      >
        <Trash2Icon class="size-3.5" />
      </Button>
    </div>

    <div v-if="expanded" class="border-t px-2.5 py-2.5 space-y-2.5">
      <Input
        v-model="label"
        class="h-8 text-xs"
        :placeholder="t('canvases.annotations.labelPlaceholder')"
        @blur="commitLabel"
        @keydown.enter="commitLabel"
      />

      <div class="flex items-center gap-1">
        <button
          v-for="swatch in ANNOTATION_COLORS"
          :key="swatch"
          class="size-5 rounded-full border transition-transform hover:scale-110"
          :class="swatch === color && 'ring-2 ring-offset-1 ring-foreground/40'"
          :style="{ background: swatch }"
          :title="swatch"
          :aria-label="swatch"
          @click="emit('update', { color: swatch })"
        />
      </div>

      <!-- Only a pin has room for a glyph; the rest are outlines. -->
      <div v-if="annotation.tool === 'pin'" class="flex items-center gap-2">
        <span class="text-xs text-muted-foreground">
          {{ t('canvases.annotations.icon') }}
        </span>
        <IconPicker
          :model-value="{ icon: annotation.icon ?? 'MapPinIcon', color: 'cobalt' }"
          @update:model-value="v => emit('update', { icon: v.icon })"
        />
      </div>
    </div>
  </div>
</template>
