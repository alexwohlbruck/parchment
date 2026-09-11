<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { PlusIcon, XIcon, CopyIcon } from 'lucide-vue-next'
import {
  WEEKDAYS,
  type Weekday,
  type WeekSchedule,
  emptyWeek,
  parseOpeningHours,
  serializeOpeningHours,
} from '@/lib/quick-edit/opening-hours-editor'

const props = defineProps<{
  modelValue?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const { t } = useI18n()

const initial = parseOpeningHours(props.modelValue ?? '')
/** Values outside the structured subset are edited as raw text, never rewritten. */
const rawMode = ref(initial === null)
const week = ref<WeekSchedule>(initial ?? emptyWeek())

const DAY_LABEL_KEYS: Record<Weekday, string> = {
  Mo: 'quickEdit.hours.mo',
  Tu: 'quickEdit.hours.tu',
  We: 'quickEdit.hours.we',
  Th: 'quickEdit.hours.th',
  Fr: 'quickEdit.hours.fr',
  Sa: 'quickEdit.hours.sa',
  Su: 'quickEdit.hours.su',
}

const alwaysOpen = computed(
  () => !rawMode.value && serializeOpeningHours(week.value) === '24/7',
)

function publish() {
  emit('update:modelValue', serializeOpeningHours(week.value))
}

function setAlwaysOpen(on: boolean) {
  const next = emptyWeek()
  if (on) for (const day of WEEKDAYS) next[day].intervals = ['00:00-24:00']
  week.value = next
  publish()
}

function setInterval(day: Weekday, index: number, part: 0 | 1, time: string) {
  const current = week.value[day].intervals[index]?.split('-') ?? ['09:00', '17:00']
  current[part] = time
  week.value[day].intervals[index] = current.join('-')
  publish()
}

function addInterval(day: Weekday) {
  const last = week.value[day].intervals.at(-1)
  week.value[day].intervals.push(last ?? '09:00-17:00')
  publish()
}

function removeInterval(day: Weekday, index: number) {
  week.value[day].intervals.splice(index, 1)
  publish()
}

function copyToAll(day: Weekday) {
  const source = [...week.value[day].intervals]
  for (const d of WEEKDAYS) week.value[d].intervals = [...source]
  publish()
}

function intervalParts(day: Weekday, index: number): [string, string] {
  const [from = '', to = ''] = week.value[day].intervals[index].split('-')
  return [from, to]
}

// An external prefill (element load, pending-edit merge) replaces local state
watch(
  () => props.modelValue,
  (value) => {
    if ((value ?? '') === (rawMode.value ? value : serializeOpeningHours(week.value))) return
    const parsed = parseOpeningHours(value ?? '')
    rawMode.value = parsed === null
    if (parsed) week.value = parsed
  },
)
</script>

<template>
  <div v-if="rawMode" class="space-y-1">
    <Input
      :model-value="modelValue ?? ''"
      :placeholder="t('quickEdit.hours.rawPlaceholder')"
      class="font-mono text-xs"
      @update:model-value="emit('update:modelValue', String($event))"
    />
    <p class="text-xs text-muted-foreground">
      {{ t('quickEdit.hours.rawNote') }}
    </p>
  </div>

  <div v-else class="space-y-2">
    <div class="flex items-center justify-between">
      <span class="text-sm text-muted-foreground">{{ t('quickEdit.hours.alwaysOpen') }}</span>
      <Switch :model-value="alwaysOpen" @update:model-value="setAlwaysOpen" />
    </div>

    <div v-if="!alwaysOpen" class="space-y-1.5">
      <div
        v-for="day in WEEKDAYS"
        :key="day"
        class="flex items-start gap-2"
      >
        <span class="w-9 pt-1.5 text-xs font-medium text-muted-foreground">
          {{ t(DAY_LABEL_KEYS[day]) }}
        </span>
        <div class="flex-1 space-y-1">
          <div
            v-for="(interval, index) in week[day].intervals"
            :key="index"
            class="flex items-center gap-1"
          >
            <Input
              type="time"
              :model-value="intervalParts(day, index)[0]"
              class="h-8 text-xs"
              @update:model-value="setInterval(day, index, 0, String($event))"
            />
            <span class="text-xs text-muted-foreground">–</span>
            <Input
              type="time"
              :model-value="intervalParts(day, index)[1]"
              class="h-8 text-xs"
              @update:model-value="setInterval(day, index, 1, String($event))"
            />
            <Button
              variant="ghost"
              size="icon"
              class="size-7 shrink-0"
              @click="removeInterval(day, index)"
            >
              <XIcon class="size-3.5" />
            </Button>
            <Button
              v-if="index === 0"
              variant="ghost"
              size="icon"
              class="size-7 shrink-0"
              :title="t('quickEdit.hours.copyToAll')"
              @click="copyToAll(day)"
            >
              <CopyIcon class="size-3.5" />
            </Button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            class="h-7 px-2 text-xs text-muted-foreground"
            @click="addInterval(day)"
          >
            <PlusIcon class="mr-1 size-3" />
            {{ t('quickEdit.hours.addHours') }}
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>
