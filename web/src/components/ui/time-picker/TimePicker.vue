<script setup lang="ts">
/**
 * A time of day, picked by dialling rather than typing.
 *
 * The native `<input type="time">` is a different control on every platform
 * — a cramped spinner on desktop, a wheel on iOS, a dialog on Android — and
 * none of them match the app. Three snapping columns behave the same
 * everywhere and are the same size under a thumb as under a cursor.
 */
import { computed } from 'vue'
import TimePickerColumn from './TimePickerColumn.vue'
import { CENTRE_OFFSET, ROW_HEIGHT, VISIBLE_ROWS } from './geometry'
import { joinClockTime, splitClockTime, type ClockParts } from '@/lib/time-format'

const props = withDefaults(defineProps<{
  /** 24-hour `"HH:mm"`. */
  modelValue: string
  /** Minutes between offered values. */
  step?: number
  disabled?: boolean
}>(), { step: 5 })

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const parts = computed(
  () => splitClockTime(props.modelValue) ?? { hour: 12, minute: 0, period: 'AM' as const },
)

const hours = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: String(i + 1) }))
const minutes = computed(() =>
  Array.from({ length: Math.ceil(60 / props.step) }, (_, i) => {
    const minute = i * props.step
    return { value: minute, label: minute.toString().padStart(2, '0') }
  }),
)
const periods = [
  { value: 'AM', label: 'AM' },
  { value: 'PM', label: 'PM' },
]

function update(change: Partial<ClockParts>) {
  emit('update:modelValue', joinClockTime({ ...parts.value, ...change }))
}
</script>

<template>
  <div
    class="relative flex items-start overflow-hidden rounded-lg border border-input bg-background"
    :class="disabled && 'pointer-events-none opacity-40'"
    :style="{ height: `${ROW_HEIGHT * VISIBLE_ROWS}px` }"
  >
    <!-- The band the selected row rests in, placed on the row grid rather
         than the control's centre. Behind the columns, so a row scrolling
         past reads as passing through it. -->
    <div
      class="pointer-events-none absolute inset-x-1 rounded-md bg-muted"
      :style="{ top: `${CENTRE_OFFSET}px`, height: `${ROW_HEIGHT}px` }"
    />

    <TimePickerColumn
      :options="hours"
      :model-value="parts.hour"
      label="Hour"
      class="relative"
      @update:model-value="v => update({ hour: v as number })"
    />
    <span
      class="relative flex items-center text-base text-muted-foreground"
      :style="{ height: `${ROW_HEIGHT * VISIBLE_ROWS}px` }"
    >:</span>
    <TimePickerColumn
      :options="minutes"
      :model-value="parts.minute"
      label="Minute"
      class="relative"
      @update:model-value="v => update({ minute: v as number })"
    />
    <TimePickerColumn
      :options="periods"
      :model-value="parts.period"
      label="AM or PM"
      class="relative"
      @update:model-value="v => update({ period: v as 'AM' | 'PM' })"
    />

    <!-- Fade the rows away at the ends so the column reads as a dial that
         carries on rather than a list that stops. -->
    <div class="pointer-events-none absolute inset-x-0 top-0 h-10 rounded-t-lg bg-gradient-to-b from-background to-transparent" />
    <div class="pointer-events-none absolute inset-x-0 bottom-0 h-10 rounded-b-lg bg-gradient-to-t from-background to-transparent" />
  </div>
</template>
