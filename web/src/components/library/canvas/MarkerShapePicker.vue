<script setup lang="ts">
/**
 * Which shape a pin wears, drawn rather than named — three small previews say
 * what a disc, a square plate and a bare glyph look like faster than three
 * words do, and each is painted in the pin's own colour, so the choice is
 * between three versions of *this* pin.
 *
 * Shared by the toolbar, where it sets what the next pin will be, and by a
 * mark's own style editor, where it restyles the pin you have.
 */
import { useI18n } from 'vue-i18n'
import { markerPaint, MARKER_SHAPES, type MarkerShape } from '@/lib/map-marker'
import { themeColorToHex } from '@/lib/utils'
import { useThemeStore } from '@/stores/theme.store'

const props = defineProps<{
  modelValue: MarkerShape
  /** The pin's colour, so each preview is the mark itself. */
  color: string
}>()

defineEmits<{ 'update:modelValue': [shape: MarkerShape] }>()

const { t } = useI18n()
const themeStore = useThemeStore()

function preview(shape: MarkerShape) {
  const paint = markerPaint(
    themeColorToHex(props.color),
    shape,
    themeStore.isDark,
  )
  return shape === 'glyph'
    ? { color: paint.ink }
    : { backgroundColor: paint.plate ?? 'transparent', borderColor: paint.ring }
}
</script>

<template>
  <span class="flex items-center gap-1">
    <button
      v-for="shape in MARKER_SHAPES"
      :key="shape"
      type="button"
      class="size-7 rounded-md flex items-center justify-center transition-colors hover:bg-accent"
      :class="modelValue === shape && 'bg-accent'"
      :title="t(`canvases.annotations.markerShapes.${shape}`)"
      :aria-label="t(`canvases.annotations.markerShapes.${shape}`)"
      :aria-pressed="modelValue === shape"
      @click="$emit('update:modelValue', shape)"
    >
      <span
        class="size-3.5 border-[1.5px] flex items-center justify-center"
        :class="{
          'rounded-full': shape === 'disc',
          'rounded-[3px]': shape === 'square',
          'border-transparent': shape === 'glyph',
        }"
        :style="preview(shape)"
      >
        <span
          v-if="shape === 'glyph'"
          class="size-2 rounded-[1px]"
          :style="{ backgroundColor: 'currentColor' }"
        />
      </span>
    </button>
  </span>
</template>
