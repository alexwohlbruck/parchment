<script setup lang="ts">
/**
 * The time every active temporal layer draws: a Monday-first day strip, a
 * time-of-day slider, and a chip that snaps back to now.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RadioIcon } from 'lucide-vue-next'
import { Slider } from '@/components/ui/slider'
import { useMapTimeStore } from '@/stores/map-time.store'

const store = useMapTimeStore()
const { t, locale } = useI18n()

const STEP_MINUTES = 5
const MAX_MINUTES = 24 * 60 - STEP_MINUTES

// Monday-first weekday letters in the user's own locale.
// 2026-08-17 is a Monday, so index i is Monday+i.
const dayLabels = computed(() => {
  const fmt = new Intl.DateTimeFormat(locale.value, { weekday: 'narrow' })
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2026, 7, 17 + i)))
})

const timeLabel = computed(() =>
  new Intl.DateTimeFormat(locale.value, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(
    store.time,
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
  <div class="space-y-2 rounded-md border bg-card/70 px-2.5 py-2">
    <div class="flex items-center gap-2">
      <span class="min-w-0 flex-1 truncate text-sm font-medium tabular-nums">
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
        {{ t('layers.time.now') }}
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
      :aria-label="t('layers.time.title')"
      @update:model-value="onSlide"
    />
  </div>
</template>
