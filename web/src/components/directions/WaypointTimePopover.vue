<script setup lang="ts">
/**
 * Per-waypoint time constraint.
 *
 * Reached from a stop's row and shown as a bottom sheet on touch. Everything
 * here is chosen by tapping: the date is a choice between today and tomorrow
 * rather than a calendar, the time is the platform's own time control, and a
 * stay is a set of durations rather than a number to type. Nothing is applied
 * until "Done", because each change re-plans the whole trip.
 */
import { computed, ref, watch } from 'vue'
import dayjs from 'dayjs'
import { ClockIcon, AlertTriangleIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import ResponsivePopover from '@/components/responsive/ResponsivePopover.vue'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { TimePicker } from '@/components/ui/time-picker'
import {
  DWELL_OPTIONS,
  QUICK_OFFSETS,
  buildConstraint,
  constraintSummary,
  constraintWarning,
  formatDwell,
  roundUpToFive,
  waypointRole,
} from '@/lib/directions/waypoint-time'
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
  /** Controlled open state (for programmatic opening from mobile menu). */
  open?: boolean
  /** When the planned trip reaches this stop. */
  arrivesAt?: Date | null
  /** Name of this stop, for the sheet's heading. */
  label?: string
  /** Earliest this stop may be left, given every leg before it. */
  earliest?: Date | null
  /** Latest, given any deadline further along the trip. */
  latest?: Date | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: WaypointTimeConstraint | null]
  'update:open': [value: boolean]
}>()

const open = ref(props.open ?? false)
watch(() => props.open, (v) => { if (v !== undefined) open.value = v })
watch(open, (v) => emit('update:open', v))

const role = computed(() => waypointRole(props.index, props.waypointCount))
const isStop = computed(() => role.value === 'stop')

// ── Draft state ─────────────────────────────────────────────────
// Held locally and only handed over on Done. Editing in place would re-plan
// the trip on every keystroke, and a plan takes seconds.

const mode = ref<WaypointTimeMode>('departAfter')
const day = ref<string>('')       // YYYY-MM-DD
const clock = ref<string>('')     // HH:mm
const dwell = ref<number | null>(null)
const timed = ref(true)

/**
 * What this stop's time should start from when nothing is set yet.
 *
 * The floor wins over the arrival: a stop can't be left before the legs
 * before it have run, so opening the picker on an impossible time would
 * only invite the rider to confirm one.
 */
const baseline = computed(() => {
  const from = props.earliest
    ? dayjs(props.earliest)
    : roundUpToFive(props.arrivesAt ? dayjs(props.arrivesAt) : dayjs())
  return roundUpToFive(from)
})

/** The bounds as clock times, but only on the day actually being edited. */
const dayBound = (bound: Date | null | undefined, edge: 'min' | 'max') => {
  if (!bound) return null
  const at = dayjs(bound)
  const editing = dayjs(day.value)
  if (at.isSame(editing, 'day')) return at.format('HH:mm')
  // A whole day before the floor (or after the ceiling) is out of reach.
  const before = at.isAfter(editing, 'day')
  if (edge === 'min') return before ? '23:59' : null
  return before ? null : '00:00'
}

const minTime = computed(() => dayBound(props.earliest, 'min'))
const maxTime = computed(() => dayBound(props.latest, 'max'))

function loadDraft() {
  const current = props.modelValue
  mode.value = current?.mode
    ?? (role.value === 'destination' ? 'arriveBy' : 'departAfter')
  dwell.value = current?.dwellTime ?? null

  const start = current?.time ? dayjs(current.time) : baseline.value
  day.value = start.format('YYYY-MM-DD')
  clock.value = start.format('HH:mm')
  // A stop can be asked to hold a stay without being pinned to a clock, so
  // the wheel showing a time doesn't mean one is being demanded.
  timed.value = !current || !!current.time
}

// Reload whenever the sheet opens, so a draft abandoned last time doesn't
// come back, and an edit made elsewhere is picked up.
watch(open, (isOpen) => { if (isOpen) loadDraft() }, { immediate: true })
watch(() => props.modelValue, () => { if (!open.value) loadDraft() })

const dayOptions = computed(() => {
  const from = roundUpToFive(dayjs())
  const floor = props.earliest ? dayjs(props.earliest) : null
  const ceiling = props.latest ? dayjs(props.latest) : null

  return [
    { value: from.format('YYYY-MM-DD'), label: 'Today' },
    { value: from.add(1, 'day').format('YYYY-MM-DD'), label: 'Tomorrow' },
  ].map((option) => {
    const at = dayjs(option.value)
    return {
      ...option,
      // A day entirely before the floor, or after the deadline, is not a
      // day this stop can happen on.
      disabled: (!!floor && at.isBefore(floor, 'day'))
        || (!!ceiling && at.isAfter(ceiling, 'day')),
    }
  })
})

/** Composed instant, or null while no time of day has been picked. */
const draftTime = computed(() =>
  timed.value && clock.value ? dayjs(`${day.value}T${clock.value}`) : null,
)

const warning = computed(() => constraintWarning({
  time: draftTime.value,
  dwellMinutes: dwell.value,
  previous: props.prevConstraint,
  next: props.nextConstraint,
}))

function shiftBy(minutes: number) {
  let next = (draftTime.value ?? baseline.value).add(minutes, 'minute')
  if (props.latest && next.isAfter(dayjs(props.latest))) next = dayjs(props.latest)
  timed.value = true
  day.value = next.format('YYYY-MM-DD')
  clock.value = next.format('HH:mm')
}

function setDwell(minutes: number) {
  dwell.value = dwell.value === minutes ? null : minutes
}

function apply() {
  emit('update:modelValue', buildConstraint({
    mode: mode.value,
    time: draftTime.value,
    dwellMinutes: dwell.value,
  }))
  open.value = false
}

function remove() {
  emit('update:modelValue', null)
  open.value = false
}

// ── Trigger ─────────────────────────────────────────────────────

const summary = computed(() => constraintSummary(props.modelValue, props.arrivesAt))
const isSet = computed(() => summary.value?.tone === 'set')

const heading = computed(() => {
  if (role.value === 'origin') return 'Leave'
  if (role.value === 'destination') return 'Arrive'
  return props.label?.trim() || 'This stop'
})
</script>

<template>
  <ResponsivePopover
    v-model:open="open"
    side="bottom"
    align="end"
    :side-offset="8"
    fit-content
    desktop-content-class="w-80 p-0"
  >
    <template #trigger>
      <!-- Always present, never hover-gated: on a touch screen there is no
           hover, and a control you cannot find is a control you do not have. -->
      <Button
        variant="ghost"
        size="sm"
        class="h-10 min-w-10 shrink-0 gap-1.5 px-2"
        :class="isSet ? 'text-primary' : 'text-muted-foreground'"
        :aria-label="summary ? `Time for ${heading}: ${summary.text}` : `Set a time for ${heading}`"
      >
        <ClockIcon class="size-4" />
        <span v-if="summary" class="text-xs tabular-nums" :class="isSet && 'font-medium'">
          {{ summary.text }}
        </span>
      </Button>
    </template>

    <template #content>
      <div class="p-4 space-y-4">
        <div class="space-y-0.5">
          <p class="text-sm font-medium leading-tight">{{ heading }}</p>
          <p v-if="arrivesAt && !modelValue?.time" class="text-xs text-muted-foreground">
            Arriving {{ dayjs(arrivesAt).format('h:mm A') }} — the next leg leaves then.
          </p>
        </div>

        <!-- Only a stop in the middle has a choice; the origin departs and
             the destination arrives, and offering the other reads as a bug. -->
        <ToggleGroup
          v-if="isStop"
          type="single"
          :model-value="mode"
          class="grid grid-cols-2 gap-1"
          @update:model-value="v => v && (mode = v as WaypointTimeMode)"
        >
          <ToggleGroupItem
            value="departAfter"
            variant="outline"
            class="h-10 w-full text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
          >
            Leave after
          </ToggleGroupItem>
          <ToggleGroupItem
            value="arriveBy"
            variant="outline"
            class="h-10 w-full text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
          >
            Arrive by
          </ToggleGroupItem>
        </ToggleGroup>

        <div class="space-y-2">
          <div class="grid grid-cols-2 gap-1">
            <Button
              v-for="option in dayOptions"
              :key="option.value"
              :variant="day === option.value && timed ? 'default' : 'outline'"
              :disabled="option.disabled"
              class="h-10 text-xs"
              @click="day = option.value; timed = true"
            >
              {{ option.label }}
            </Button>
          </div>

          <TimePicker
            v-model="clock"
            :disabled="!timed"
            :min="minTime"
            :max="maxTime"
            @update:model-value="timed = true"
          />

          <div class="grid gap-1" :class="isStop ? 'grid-cols-4' : 'grid-cols-3'">
            <Button
              v-if="isStop"
              :variant="timed ? 'ghost' : 'default'"
              class="h-9 px-1 text-xs"
              :class="timed && 'text-muted-foreground'"
              @click="timed = !timed"
            >
              Any time
            </Button>
            <Button
              v-for="offset in QUICK_OFFSETS"
              :key="offset"
              variant="ghost"
              class="h-9 px-1 text-xs text-muted-foreground"
              @click="shiftBy(offset)"
            >
              +{{ formatDwell(offset) }}
            </Button>
          </div>
        </div>

        <div v-if="isStop" class="space-y-2">
          <p class="text-xs text-muted-foreground">Stay here</p>
          <div class="grid grid-cols-3 gap-1">
            <Button
              v-for="minutes in DWELL_OPTIONS"
              :key="minutes"
              :variant="dwell === minutes ? 'default' : 'outline'"
              class="h-10 text-xs"
              @click="setDwell(minutes)"
            >
              {{ formatDwell(minutes) }}
            </Button>
          </div>
        </div>

        <div
          v-if="warning"
          class="flex gap-2 rounded-md bg-amber-50 p-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
        >
          <AlertTriangleIcon class="mt-0.5 size-3.5 shrink-0" />
          <span>{{ warning }}</span>
        </div>

        <div class="flex gap-2">
          <Button
            v-if="modelValue"
            variant="outline"
            class="h-11 flex-1 text-xs"
            @click="remove"
          >
            Remove
          </Button>
          <Button class="h-11 flex-1 text-sm" @click="apply">Done</Button>
        </div>
      </div>
    </template>
  </ResponsivePopover>
</template>
