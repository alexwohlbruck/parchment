<script setup lang="ts">
/**
 * One scrolling column of a `TimePicker`.
 *
 * Scroll snapping does the work: the row resting in the centre band is the
 * selected one, so a flick lands on a value the way a physical dial would,
 * and a tap on any visible row scrolls it home.
 */
import { onBeforeUnmount, onMounted, ref, watch, nextTick } from 'vue'

const props = defineProps<{
  options: { value: number | string; label: string; disabled?: boolean }[]
  modelValue: number | string
  /** Announced to screen readers, e.g. "Hour". */
  label: string
  /** Row height in pixels; the column shows five. */
  rowHeight?: number
}>()

const emit = defineEmits<{ 'update:modelValue': [value: number | string] }>()

import { ROW_HEIGHT, VISIBLE_ROWS } from './geometry'

const ROW = props.rowHeight ?? ROW_HEIGHT
const VISIBLE = VISIBLE_ROWS

const list = ref<HTMLElement | null>(null)
/** Set while we drive the scroll ourselves, so it isn't read back as a pick. */
const settling = ref(false)
let settleTimer: ReturnType<typeof setTimeout> | undefined

function indexOfValue(value: number | string) {
  const index = props.options.findIndex((o) => o.value === value)
  return index === -1 ? 0 : index
}

function scrollToValue(value: number | string, smooth = false) {
  const element = list.value
  if (!element) return
  const top = indexOfValue(value) * ROW
  if (Math.abs(element.scrollTop - top) < 1) return

  settling.value = true
  element.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' })
  clearTimeout(settleTimer)
  settleTimer = setTimeout(() => { settling.value = false }, smooth ? 400 : 60)
}

let readTimer: ReturnType<typeof setTimeout> | undefined
function onScroll() {
  if (settling.value) return
  clearTimeout(readTimer)
  // Read once the flick has come to rest; scrollend isn't everywhere yet.
  readTimer = setTimeout(() => {
    const element = list.value
    if (!element) return
    const index = Math.max(
      0,
      Math.min(props.options.length - 1, Math.round(element.scrollTop / ROW)),
    )
    const picked = props.options[index]?.value
    if (picked !== undefined && picked !== props.modelValue) {
      emit('update:modelValue', picked)
    }
  }, 90)
}

function pick(option: { value: number | string; disabled?: boolean }) {
  if (option.disabled) return
  emit('update:modelValue', option.value)
  scrollToValue(option.value, true)
}

// A column inside a sheet is laid out before it is shown, and scrollTop on a
// zero-height box goes nowhere — so re-seat the selection the moment it first
// has a size, or it opens showing the first row instead of the chosen one.
let resize: ResizeObserver | undefined
onMounted(() => {
  nextTick(() => scrollToValue(props.modelValue))
  if (typeof ResizeObserver === 'undefined' || !list.value) return
  resize = new ResizeObserver(([entry]) => {
    if (entry.contentRect.height > 0) scrollToValue(props.modelValue)
  })
  resize.observe(list.value)
})

onBeforeUnmount(() => {
  resize?.disconnect()
  clearTimeout(settleTimer)
  clearTimeout(readTimer)
})

watch(() => props.modelValue, (value) => scrollToValue(value, true))
watch(() => props.options, () => nextTick(() => scrollToValue(props.modelValue)))
</script>

<template>
  <div
    ref="list"
    role="listbox"
    :aria-label="label"
    class="scrollbar-hidden flex-1 snap-y snap-mandatory touch-pan-y overflow-y-auto overscroll-contain"
    :style="{ height: `${ROW * VISIBLE}px`, paddingBlock: `${ROW * (VISIBLE - 1) / 2}px` }"
    @scroll="onScroll"
  >
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="option"
      :aria-selected="option.value === modelValue"
      :aria-disabled="option.disabled || undefined"
      class="flex w-full snap-center items-center justify-center text-base tabular-nums transition-colors"
      :class="option.disabled
        ? 'text-muted-foreground/25'
        : option.value === modelValue
          ? 'font-medium text-foreground'
          : 'text-muted-foreground/70'"
      :style="{ height: `${ROW}px` }"
      @click="pick(option)"
    >
      {{ option.label }}
    </button>
  </div>
</template>
