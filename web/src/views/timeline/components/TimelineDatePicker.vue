<script setup lang="ts">
import { computed } from 'vue'
import {
  CalendarDate,
  DateFormatter,
  getLocalTimeZone,
  type DateValue,
} from '@internationalized/date'
import { CalendarIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

const props = defineProps<{
  modelValue: Date
  placeholder?: string
  class?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: Date): void
}>()

const formatter = new DateFormatter('en-US', { dateStyle: 'medium' })

const calendarValue = computed<DateValue>(
  () =>
    new CalendarDate(
      props.modelValue.getFullYear(),
      props.modelValue.getMonth() + 1,
      props.modelValue.getDate(),
    ),
)

function onCalendarUpdate(next: DateValue | undefined) {
  if (!next) return
  const tz = getLocalTimeZone()
  const native = next.toDate(tz)
  // Preserve the time-of-day of the previous selection so callers don't
  // accidentally widen / narrow ranges when the day is changed.
  native.setHours(
    props.modelValue.getHours(),
    props.modelValue.getMinutes(),
    props.modelValue.getSeconds(),
    props.modelValue.getMilliseconds(),
  )
  emit('update:modelValue', native)
}

const label = computed(() =>
  formatter.format(calendarValue.value.toDate(getLocalTimeZone())),
)
</script>

<template>
  <Popover>
    <PopoverTrigger as-child>
      <Button
        variant="outline"
        :class="
          cn('justify-start text-left font-normal min-w-0', props.class)
        "
      >
        <CalendarIcon class="mr-2 h-4 w-4 shrink-0" />
        <span class="truncate">{{ label }}</span>
      </Button>
    </PopoverTrigger>
    <PopoverContent class="w-auto p-0" align="start">
      <Calendar
        :model-value="calendarValue"
        @update:model-value="onCalendarUpdate"
        initial-focus
      />
    </PopoverContent>
  </Popover>
</template>
