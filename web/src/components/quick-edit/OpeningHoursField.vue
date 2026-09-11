<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { PlusIcon, XIcon, CopyIcon } from 'lucide-vue-next'
import TimeButton from './TimeButton.vue'
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

const DEFAULT_INTERVAL = '09:00-17:00'

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

function parts(day: Weekday, index: number): [string, string] {
  const [from = '', to = ''] = week.value[day].intervals[index].split('-')
  return [from, to]
}

function setPart(day: Weekday, index: number, part: 0 | 1, time: string) {
  const current = parts(day, index)
  current[part] = time
  week.value[day].intervals[index] = current.join('-')
  publish()
}

function addInterval(day: Weekday) {
  week.value[day].intervals.push(
    week.value[day].intervals.at(-1) ?? DEFAULT_INTERVAL,
  )
  publish()
}

function removeInterval(day: Weekday, index: number) {
  week.value[day].intervals.splice(index, 1)
  publish()
}

function copyToAll(day: Weekday) {
  const source = [...week.value[day].intervals]
  for (const other of WEEKDAYS) week.value[other].intervals = [...source]
  publish()
}

// An external prefill (element load, brand apply) replaces local state
watch(
  () => props.modelValue,
  (value) => {
    if ((value ?? '') === serializeOpeningHours(week.value)) return
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
    <p class="text-xs text-muted-foreground">{{ t('quickEdit.hours.rawNote') }}</p>
  </div>

  <div v-else class="space-y-2">
    <label class="flex cursor-pointer items-center justify-between">
      <span class="text-sm">{{ t('quickEdit.hours.alwaysOpen') }}</span>
      <Switch :model-value="alwaysOpen" @update:model-value="setAlwaysOpen" />
    </label>

    <div v-if="!alwaysOpen" class="space-y-0.5">
      <div
        v-for="day in WEEKDAYS"
        :key="day"
        class="group flex min-h-8 items-start gap-2"
      >
        <span class="w-8 shrink-0 pt-1.5 text-xs text-muted-foreground">
          {{ t(DAY_LABEL_KEYS[day]) }}
        </span>

        <div class="flex min-w-0 flex-1 flex-wrap items-center gap-1 py-1">
          <template v-if="week[day].intervals.length">
            <span
              v-for="(interval, index) in week[day].intervals"
              :key="index"
              class="flex items-center gap-1"
            >
              <TimeButton
                :model-value="parts(day, index)[0]"
                @update:model-value="setPart(day, index, 0, $event)"
              />
              <span class="text-xs text-muted-foreground">–</span>
              <TimeButton
                :model-value="parts(day, index)[1]"
                :min="parts(day, index)[0]"
                @update:model-value="setPart(day, index, 1, $event)"
              />
              <button
                type="button"
                class="text-muted-foreground/60 transition-colors hover:text-foreground"
                :aria-label="t('quickEdit.hours.removeInterval')"
                @click="removeInterval(day, index)"
              >
                <XIcon class="size-3" />
              </button>
            </span>
          </template>

          <button
            v-else
            type="button"
            class="text-xs text-muted-foreground transition-colors hover:text-foreground"
            @click="addInterval(day)"
          >
            {{ t('quickEdit.hours.closed') }}
          </button>
        </div>

        <!-- Row actions stay quiet until the row is in play. -->
        <div
          class="flex shrink-0 items-center gap-0.5 pt-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100"
        >
          <Button
            variant="ghost"
            size="icon"
            class="size-6 text-muted-foreground"
            :title="t('quickEdit.hours.addInterval')"
            @click="addInterval(day)"
          >
            <PlusIcon class="size-3" />
          </Button>
          <Button
            v-if="week[day].intervals.length"
            variant="ghost"
            size="icon"
            class="size-6 text-muted-foreground"
            :title="t('quickEdit.hours.copyToAll')"
            @click="copyToAll(day)"
          >
            <CopyIcon class="size-3" />
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>
