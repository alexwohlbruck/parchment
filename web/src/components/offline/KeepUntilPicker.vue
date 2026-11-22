<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { PopoverAnchor } from 'reka-ui'
import { getLocalTimeZone, parseDate, today, type DateValue } from '@internationalized/date'
import { CalendarIcon, CheckIcon, ChevronLeftIcon } from 'lucide-vue-next'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent } from '@/components/ui/popover'
import { addDays, dayAsDate, localDay } from '@/lib/offline/expiry'

/** `null` keeps the area until it's deleted; a day keeps it through that day. */
const keepUntil = defineModel<string | null>({ required: true })
const open = defineModel<boolean>('open', { default: false })

const PRESETS = [
  { id: 'week', days: 7 },
  { id: 'month', days: 30 },
  { id: 'months3', days: 90 },
  { id: 'year', days: 365 },
] as const

const { t, locale } = useI18n()
const picking = ref(false)
watch(open, isOpen => isOpen || (picking.value = false))

const shortDay = (day: string) =>
  dayAsDate(day).toLocaleDateString(locale.value, { month: 'short', day: 'numeric' })
const presets = computed(() =>
  PRESETS.map(p => ({ ...p, day: localDay(addDays(new Date(), p.days)) })),
)
const preset = computed(() => presets.value.find(p => p.day === keepUntil.value))

const label = computed(() =>
  keepUntil.value ? t('offlineMaps.keep.until', { date: shortDay(keepUntil.value) }) : t('offlineMaps.keep.forever'),
)

function choose(day: string | null) {
  keepUntil.value = day
  open.value = false
}

const calendarDay = computed({
  get: () => (keepUntil.value ? parseDate(keepUntil.value) : undefined),
  set: (next: DateValue | undefined) => next && choose(next.toString()),
})
const tomorrow = today(getLocalTimeZone()).add({ days: 1 })

const OPTION =
  'flex w-full items-center gap-3 rounded-sm px-2.5 py-2 text-left text-sm outline-hidden hover:bg-accent focus-visible:bg-accent'
</script>

<template>
  <Popover v-model:open="open">
    <PopoverAnchor as-child>
      <slot :label="label" :open="() => (open = true)" />
    </PopoverAnchor>
    <PopoverContent align="end" class="w-auto min-w-60 p-1">
      <Calendar v-if="picking" v-model="calendarDay" :min-value="tomorrow" class="p-2" />
      <template v-else>
        <button type="button" :class="OPTION" @click="choose(null)">
          <span class="flex-1">{{ t('offlineMaps.keep.forever') }}</span>
          <CheckIcon class="size-4" :class="keepUntil && 'invisible'" />
        </button>
        <button v-for="p in presets" :key="p.id" type="button" :class="OPTION" @click="choose(p.day)">
          <span class="flex-1">{{ t(`offlineMaps.keep.${p.id}`) }}</span>
          <span class="text-xs text-muted-foreground tabular-nums">{{ shortDay(p.day) }}</span>
          <CheckIcon class="size-4" :class="preset?.id !== p.id && 'invisible'" />
        </button>
        <button type="button" :class="OPTION" @click="picking = true">
          <span class="flex-1">{{ t('offlineMaps.keep.pick') }}</span>
          <span v-if="keepUntil && !preset" class="text-xs text-muted-foreground tabular-nums">
            {{ shortDay(keepUntil) }}
          </span>
          <CheckIcon v-if="keepUntil && !preset" class="size-4" />
          <CalendarIcon v-else class="size-4 text-muted-foreground" />
        </button>
      </template>
      <button v-if="picking" type="button" :class="[OPTION, 'text-muted-foreground']" @click="picking = false">
        <ChevronLeftIcon class="size-4" />
        <span class="flex-1">{{ t('general.back') }}</span>
      </button>
    </PopoverContent>
  </Popover>
</template>
