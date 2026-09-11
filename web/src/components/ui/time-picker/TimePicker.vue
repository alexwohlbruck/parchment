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
  /** Earliest selectable `"HH:mm"` on the day being edited. */
  min?: string | null
  /** Latest selectable `"HH:mm"` on the day being edited. */
  max?: string | null
}>(), { step: 5 })

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const parts = computed(
  () => splitClockTime(props.modelValue) ?? { hour: 12, minute: 0, period: 'AM' as const },
)

/** Minutes past midnight, for comparing against the bounds. */
const asMinutes = (time: string | null | undefined) => {
  const split = time ? splitClockTime(time) : null
  if (!split) return null
  return (split.hour % 12) * 60 + (split.period === 'PM' ? 720 : 0) + split.minute
}

const floor = computed(() => asMinutes(props.min))
const ceiling = computed(() => asMinutes(props.max))

const allows = (minutesOfDay: number) =>
  (floor.value === null || minutesOfDay >= floor.value)
  && (ceiling.value === null || minutesOfDay <= ceiling.value)

/**
 * Whether any minute of a given hour, or any hour of a period, is reachable.
 *
 * A whole column is dimmed at that granularity rather than per-minute, so
 * scrolling past an unreachable hour doesn't flicker row by row.
 */
const hours = computed(() =>
  Array.from({ length: 12 }, (_, i) => {
    const hour = i + 1
    const base = (hour % 12) * 60 + (parts.value.period === 'PM' ? 720 : 0)
    return {
      value: hour,
      label: String(hour),
      disabled: !Array.from({ length: 60 }, (_, m) => base + m).some(allows),
    }
  }),
)

const minutes = computed(() =>
  Array.from({ length: Math.ceil(60 / props.step) }, (_, i) => {
    const minute = i * props.step
    const base = (parts.value.hour % 12) * 60 + (parts.value.period === 'PM' ? 720 : 0)
    return {
      value: minute,
      label: minute.toString().padStart(2, '0'),
      disabled: !allows(base + minute),
    }
  }),
)

const periods = computed(() => (['AM', 'PM'] as const).map((period) => ({
  value: period,
  label: period,
  disabled: !Array.from({ length: 720 }, (_, m) => (period === 'PM' ? 720 : 0) + m).some(allows),
})))

/**
 * Apply a change, pulled back inside the bounds if it fell outside them.
 *
 * Dimming an unreachable row isn't enough on a dial the rider can flick
 * past, so a value that lands out of range settles on the nearest one that
 * isn't — the control never holds a time the trip can't accommodate.
 */
function update(change: Partial<ClockParts>) {
  const next = { ...parts.value, ...change }
  const minutesOfDay = (next.hour % 12) * 60 + (next.period === 'PM' ? 720 : 0) + next.minute

  let clamped = minutesOfDay
  if (floor.value !== null && clamped < floor.value) clamped = floor.value
  if (ceiling.value !== null && clamped > ceiling.value) clamped = ceiling.value

  if (clamped === minutesOfDay) {
    emit('update:modelValue', joinClockTime(next))
    return
  }
  const hours24 = Math.floor(clamped / 60)
  emit('update:modelValue', joinClockTime({
    hour: hours24 % 12 || 12,
    minute: clamped % 60,
    period: hours24 >= 12 ? 'PM' : 'AM',
  }))
}
</script>

<template>
  <!-- A flick inside the columns is a dial, not a drag on the sheet holding
       them: without this, spinning to an earlier hour throws the bottom
       sheet closed. The fork's shouldDrag() bails on this attribute. -->
  <div
    data-vaul-no-drag
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
