<script setup lang="ts">
/**
 * How a mark is drawn.
 *
 * Only the fields that mean something for the shape in hand: a line has no
 * fill, a pin has no outline, and offering them anyway is how a panel ends up
 * mostly greyed out. Everything falls back to a default rather than being
 * written into the mark, so a mark you never styled stays as small as the
 * day it was made.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Slider } from '@/components/ui/slider'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { IconPicker } from '@/components/ui/icon-picker'
import { annotationStyle } from '@/lib/canvas-annotations'
import {
  ANNOTATION_STROKE_STYLES,
  type AnnotationStrokeStyle,
  type CanvasAnnotation,
} from '@/types/canvas.types'

const props = defineProps<{ annotation: CanvasAnnotation }>()
const emit = defineEmits<{ update: [patch: Partial<CanvasAnnotation>] }>()

const { t } = useI18n()

/** What the mark is actually drawn as right now, defaults included. */
const style = computed(() => annotationStyle(props.annotation))

const tool = computed(() => props.annotation.tool)
/** Shapes that enclose something have a fill; the rest are outlines. */
const hasFill = computed(() =>
  ['polygon', 'rectangle', 'circle', 'isochrone'].includes(tool.value),
)
const hasStroke = computed(() => tool.value !== 'pin')
const isPin = computed(() => tool.value === 'pin')

const strokeStyles = computed(() =>
  ANNOTATION_STROKE_STYLES.map(value => ({
    value,
    label: t(`canvases.annotations.strokeStyles.${value}`),
  })),
)

function percent(value: number) {
  return `${Math.round(value * 100)}%`
}
</script>

<template>
  <div>
    <template v-if="hasStroke">
      <div class="flex items-center justify-between gap-3 py-1.5 min-h-7">
        <span class="text-xs shrink-0">
          {{ t('canvases.annotations.strokeWidth') }}
        </span>
        <span class="flex items-center gap-2">
          <Slider
            :model-value="[style.strokeWidth]"
            :min="1"
            :max="24"
            :step="1"
            class="w-24"
            @update:model-value="v => emit('update', { strokeWidth: v?.[0] })"
          />
          <span class="w-8 text-right text-xs tabular-nums text-muted-foreground">
            {{ style.strokeWidth }}
          </span>
        </span>
      </div>

      <div class="flex items-center justify-between gap-3 py-1.5 min-h-7">
        <span class="text-xs shrink-0">
          {{ t('canvases.annotations.strokeStyle') }}
        </span>
        <Select
          :model-value="style.strokeStyle"
          @update:model-value="
            v => emit('update', { strokeStyle: v as AnnotationStrokeStyle })
          "
        >
          <SelectTrigger class="h-7 w-28 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="option in strokeStyles"
              :key="option.value"
              :value="option.value"
              class="text-xs"
            >
              {{ option.label }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div class="flex items-center justify-between gap-3 py-1.5 min-h-7">
        <span class="text-xs shrink-0">
          {{ t('canvases.annotations.strokeOpacity') }}
        </span>
        <span class="flex items-center gap-2">
          <Slider
            :model-value="[style.strokeOpacity * 100]"
            :min="0"
            :max="100"
            :step="5"
            class="w-24"
            @update:model-value="
              v => emit('update', { strokeOpacity: (v?.[0] ?? 100) / 100 })
            "
          />
          <span class="w-8 text-right text-xs tabular-nums text-muted-foreground">
            {{ percent(style.strokeOpacity) }}
          </span>
        </span>
      </div>
    </template>

    <template v-if="hasFill">
      <div class="flex items-center justify-between gap-3 py-1.5 min-h-7">
        <span class="text-xs shrink-0">
          {{ t('canvases.annotations.fillColor') }}
        </span>
        <IconPicker
          compact
          color-only
          allow-custom-color
          :model-value="{
            icon: '',
            color: annotation.fillColor ?? annotation.color ?? 'compass',
          }"
          @update:model-value="v => emit('update', { fillColor: v.color })"
        />
      </div>

      <div class="flex items-center justify-between gap-3 py-1.5 min-h-7">
        <span class="text-xs shrink-0">
          {{ t('canvases.annotations.fillOpacity') }}
        </span>
        <span class="flex items-center gap-2">
          <Slider
            :model-value="[style.fillOpacity * 100]"
            :min="0"
            :max="100"
            :step="5"
            class="w-24"
            @update:model-value="
              v => emit('update', { fillOpacity: (v?.[0] ?? 0) / 100 })
            "
          />
          <span class="w-8 text-right text-xs tabular-nums text-muted-foreground">
            {{ percent(style.fillOpacity) }}
          </span>
        </span>
      </div>
    </template>

    <div
      v-if="isPin"
      class="flex items-center justify-between gap-3 py-1.5 min-h-7"
    >
      <span class="text-xs shrink-0">
        {{ t('canvases.annotations.markerSize') }}
      </span>
      <span class="flex items-center gap-2">
        <Slider
          :model-value="[style.markerSize]"
          :min="4"
          :max="20"
          :step="0.5"
          class="w-24"
          @update:model-value="v => emit('update', { markerSize: v?.[0] })"
        />
        <span class="w-8 text-right text-xs tabular-nums text-muted-foreground">
          {{ style.markerSize }}
        </span>
      </span>
    </div>

    <div
      v-if="annotation.label && annotation.labelVisible !== false"
      class="flex items-center justify-between gap-3 py-1.5 min-h-7"
    >
      <span class="text-xs shrink-0">
        {{ t('canvases.annotations.labelSize') }}
      </span>
      <span class="flex items-center gap-2">
        <Slider
          :model-value="[style.labelSize]"
          :min="8"
          :max="32"
          :step="1"
          class="w-24"
          @update:model-value="v => emit('update', { labelSize: v?.[0] })"
        />
        <span class="w-8 text-right text-xs tabular-nums text-muted-foreground">
          {{ style.labelSize }}
        </span>
      </span>
    </div>
  </div>
</template>
