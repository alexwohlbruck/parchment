<script setup lang="ts">
/**
 * Service-time control for the Transit layer group: a day-of-week strip
 * (Monday-first, matching portolan's acts masks), a time-of-day slider,
 * and a Live chip.
 *
 * Live is the default and follows the ticking clock; touching the slider
 * or a day detaches into a fixed time, and Live snaps back to now. State
 * lives in portolan.store and is session-only by design — a reload always
 * reopens on the live network, never on last Tuesday's.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RadioIcon } from 'lucide-vue-next'
import { Slider } from '@/components/ui/slider'
import { usePortolanTransitStore } from '@/stores/portolan.store'
import { dateAtDaySlot } from '@/services/layers/features/portolan/portolan-ui'

const store = usePortolanTransitStore()
const { t, locale } = useI18n()

/** The slider's granularity: five minutes reads smoothly and the acts
 *  filter only resolves to the hour anyway. */
const STEP_MINUTES = 5
const MAX_MINUTES = 24 * 60 - STEP_MINUTES

// Monday-first weekday letters in the user's own locale.
// 2026-08-17 is a Monday, so index i is Monday+i.
const dayLabels = computed(() => {
  const fmt = new Intl.DateTimeFormat(locale.value, { weekday: 'narrow' })
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2026, 7, 17 + i)))
})

const timeLabel = computed(() =>
  new Intl.DateTimeFormat(locale.value, { hour: 'numeric', minute: '2-digit' }).format(
    dateAtDaySlot(store.displayDay, store.displayMinutes),
  ),
)

// In live mode the slider mirrors the clock; the first touch detaches.
const sliderValue = computed(() => [store.displayMinutes])

function onSlide(value: number[] | undefined) {
  if (!value?.length) return
  store.setFixedTime(store.displayDay, value[0])
}

function pickDay(day: number) {
  store.setFixedTime(day, store.displayMinutes)
}
</script>

<template>
  <div class="mb-2 ml-[26px] mr-1 mt-0.5 space-y-2 rounded-md bg-accent/40 px-2.5 py-2">
    <div class="flex items-center gap-2">
      <span class="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
        {{ t('layers.transit.serviceTime') }}
      </span>
      <span class="shrink-0 text-xs tabular-nums text-muted-foreground">
        {{ timeLabel }}
      </span>
      <button
        type="button"
        class="flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors"
        :class="
          store.isLive
            ? 'bg-primary text-primary-foreground'
            : 'bg-secondary text-muted-foreground hover:text-foreground'
        "
        :aria-pressed="store.isLive"
        @click="store.goLive()"
      >
        <RadioIcon class="size-3" />
        {{ t('layers.transit.live') }}
      </button>
    </div>

    <div class="grid grid-cols-7 gap-1">
      <button
        v-for="(label, day) in dayLabels"
        :key="day"
        type="button"
        class="rounded py-0.5 text-xs transition-colors"
        :class="
          day === store.displayDay
            ? 'bg-primary text-primary-foreground'
            : 'bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground'
        "
        :aria-pressed="day === store.displayDay"
        @click="pickDay(day)"
      >
        {{ label }}
      </button>
    </div>

    <Slider
      class="py-1"
      :model-value="sliderValue"
      :min="0"
      :max="MAX_MINUTES"
      :step="STEP_MINUTES"
      :aria-label="t('layers.transit.serviceTime')"
      @update:model-value="onSlide"
    />
  </div>
</template>
