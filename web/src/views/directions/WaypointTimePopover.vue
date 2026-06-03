<script setup lang="ts">
/**
 * Per-waypoint time constraint popover.
 *
 * A clock icon button that opens a ResponsivePopover where the user
 * can set departure/arrival time + optional dwell time for a waypoint.
 * Validates constraints against adjacent waypoints and shows inline
 * warnings for conflicts.
 */
import { computed, ref, watch } from 'vue'
import dayjs from 'dayjs'
import { ClockIcon, AlertTriangleIcon, XIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import ResponsivePopover from '@/components/responsive/ResponsivePopover.vue'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { WaypointTimeConstraint, WaypointTimeMode } from '@/types/map.types'

const props = defineProps<{
  /** Current time constraint for this waypoint. */
  modelValue: WaypointTimeConstraint | null | undefined
  /** Index of this waypoint in the list. */
  index: number
  /** Total number of waypoints. */
  waypointCount: number
  /** Time constraint of the previous waypoint (for validation). */
  prevConstraint?: WaypointTimeConstraint | null
  /** Time constraint of the next waypoint (for validation). */
  nextConstraint?: WaypointTimeConstraint | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: WaypointTimeConstraint | null]
}>()

const open = ref(false)

const isOrigin = computed(() => props.index === 0)
const isDestination = computed(() => props.index === props.waypointCount - 1)
const isIntermediate = computed(() => !isOrigin.value && !isDestination.value)

// Local editing state
const mode = ref<WaypointTimeMode>(props.modelValue?.mode ?? 'departAfter')
const timeLocal = ref(
  props.modelValue?.time
    ? dayjs(props.modelValue.time).format('YYYY-MM-DDTHH:mm')
    : '',
)
const dwellMinutes = ref<number | null>(props.modelValue?.dwellTime ?? null)

// Sync local state when prop changes externally
watch(
  () => props.modelValue,
  (val) => {
    if (val) {
      mode.value = val.mode
      timeLocal.value = dayjs(val.time).format('YYYY-MM-DDTHH:mm')
      dwellMinutes.value = val.dwellTime ?? null
    }
  },
)

// Origin can only depart, destination can only arrive
const availableModes = computed(() => {
  if (isOrigin.value) return [{ value: 'departAfter' as const, label: 'Depart after' }]
  if (isDestination.value) return [{ value: 'arriveBy' as const, label: 'Arrive by' }]
  return [
    { value: 'departAfter' as const, label: 'Depart after' },
    { value: 'arriveBy' as const, label: 'Arrive by' },
  ]
})

// Auto-correct mode when waypoint position changes (e.g., user reorders)
watch([isOrigin, isDestination], () => {
  if (isOrigin.value && mode.value !== 'departAfter') mode.value = 'departAfter'
  if (isDestination.value && mode.value !== 'arriveBy') mode.value = 'arriveBy'
})

// ── Validation ──────────────────────────────────────────────────

const warning = computed<string | null>(() => {
  if (!timeLocal.value) return null
  const time = dayjs(timeLocal.value)
  if (!time.isValid()) return null

  // Check against previous waypoint
  if (props.prevConstraint?.time) {
    const prevTime = dayjs(props.prevConstraint.time)
    const prevDwell = props.prevConstraint.dwellTime ?? 0
    const earliestHere = prevTime.add(prevDwell, 'minute')

    if (time.isBefore(earliestHere)) {
      const diff = earliestHere.diff(time, 'minute')
      return `This is ${diff} min before the previous stop's departure${prevDwell ? ` + ${prevDwell} min dwell` : ''}. Allow more time between stops.`
    }
  }

  // Check against next waypoint
  if (props.nextConstraint?.time) {
    const nextTime = dayjs(props.nextConstraint.time)
    const thisDwell = dwellMinutes.value ?? 0
    const latestDepart = dayjs(timeLocal.value).add(thisDwell, 'minute')

    if (latestDepart.isAfter(nextTime)) {
      return `Departing here${thisDwell ? ` with ${thisDwell} min dwell` : ''} would miss the next stop's time. Adjust the schedule.`
    }
  }

  // Check if time is in the past
  if (time.isBefore(dayjs())) {
    return 'This time is in the past.'
  }

  return null
})

// ── Emit changes ────────────────────────────────────────────────

function emitUpdate() {
  if (!timeLocal.value) {
    emit('update:modelValue', null)
    return
  }
  emit('update:modelValue', {
    mode: mode.value,
    time: new Date(timeLocal.value).toISOString(),
    ...(dwellMinutes.value != null && dwellMinutes.value > 0 && { dwellTime: dwellMinutes.value }),
  })
}

watch([mode, timeLocal, dwellMinutes], emitUpdate)

function clear() {
  timeLocal.value = ''
  dwellMinutes.value = null
  emit('update:modelValue', null)
  open.value = false
}

const hasConstraint = computed(() => !!props.modelValue?.time)
const hasWarning = computed(() => !!warning.value)

const chipLabel = computed(() => {
  if (!props.modelValue?.time) return null
  const t = dayjs(props.modelValue.time)
  const prefix = props.modelValue.mode === 'departAfter' ? 'Dep' : 'Arr'
  return `${prefix} ${t.format('h:mm A')}`
})
</script>

<template>
  <ResponsivePopover
    v-model:open="open"
    side="bottom"
    align="start"
    :side-offset="8"
    fit-content
    desktop-content-class="w-72 p-0"
  >
    <template #trigger>
      <Button
        variant="ghost"
        size="icon"
        class="size-7 shrink-0"
        :class="[
          hasConstraint ? 'text-primary' : 'text-muted-foreground',
          hasWarning && hasConstraint ? 'text-amber-500' : '',
        ]"
        :title="chipLabel ?? 'Set time constraint'"
      >
        <ClockIcon class="size-3.5" />
      </Button>
    </template>

    <template #content="{ close }">
      <div class="p-3 space-y-3">
        <div class="flex items-center justify-between">
          <span class="text-sm font-medium">Time constraint</span>
          <Button
            v-if="hasConstraint"
            variant="ghost"
            size="sm"
            class="h-6 text-xs text-muted-foreground"
            @click="clear"
          >
            Clear
          </Button>
        </div>

        <!-- Mode selector (depart after / arrive by) -->
        <Select v-model="mode">
          <SelectTrigger class="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="opt in availableModes"
              :key="opt.value"
              :value="opt.value"
              class="text-xs"
            >
              {{ opt.label }}
            </SelectItem>
          </SelectContent>
        </Select>

        <!-- Time input -->
        <input
          type="datetime-local"
          class="flex w-full h-8 px-2 text-xs rounded-md border border-input bg-background ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :value="timeLocal"
          @input="(e: any) => timeLocal = e.target.value"
        />

        <!-- Dwell time (intermediate stops only) -->
        <div v-if="isIntermediate" class="space-y-1.5">
          <label class="text-xs text-muted-foreground">Time at this stop (min)</label>
          <input
            type="number"
            min="0"
            max="480"
            :value="dwellMinutes ?? ''"
            @input="(e: any) => dwellMinutes = e.target.value ? Number(e.target.value) : null"
            placeholder="0"
            class="flex w-full h-8 px-2 text-xs rounded-md border border-input bg-background ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <!-- Validation warning -->
        <div
          v-if="warning"
          class="flex gap-2 p-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded-md"
        >
          <AlertTriangleIcon class="size-3.5 shrink-0 mt-0.5" />
          <span>{{ warning }}</span>
        </div>
      </div>
    </template>
  </ResponsivePopover>
</template>
