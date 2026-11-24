<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { CalendarDate, getLocalTimeZone, type DateValue } from '@internationalized/date'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatRangeLabel } from '@/lib/timeline/timeline-days'

const props = defineProps<{
  start: Date
  end: Date
}>()

const emit = defineEmits<{
  shift: [direction: 1 | -1]
  pickDay: [day: Date]
}>()

const { t } = useI18n()
const open = ref(false)

const label = computed(() => formatRangeLabel(props.start, props.end))

const calendarValue = computed<DateValue>(
  () =>
    new CalendarDate(
      props.start.getFullYear(),
      props.start.getMonth() + 1,
      props.start.getDate(),
    ),
)

function onPick(next: DateValue | undefined) {
  if (!next) return
  open.value = false
  emit('pickDay', next.toDate(getLocalTimeZone()))
}
</script>

<template>
  <div class="flex items-center gap-1">
    <Button
      variant="ghost"
      size="icon"
      class="size-8 shrink-0"
      :aria-label="t('timeline.previous')"
      @click="emit('shift', -1)"
    >
      <ChevronLeftIcon class="size-4" />
    </Button>

    <Popover v-model:open="open">
      <PopoverTrigger as-child>
        <Button variant="ghost" size="sm" class="flex-1 min-w-0 font-semibold tabular-nums">
          <span class="truncate">{{ label }}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent class="w-auto p-0" align="center">
        <Calendar :model-value="calendarValue" initial-focus @update:model-value="onPick" />
      </PopoverContent>
    </Popover>

    <Button
      variant="ghost"
      size="icon"
      class="size-8 shrink-0"
      :aria-label="t('timeline.next')"
      @click="emit('shift', 1)"
    >
      <ChevronRightIcon class="size-4" />
    </Button>
  </div>
</template>
