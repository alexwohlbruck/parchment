<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatDurationLong, formatDurationShort } from '@/lib/time-format'
import type { BoardingPosition } from '@server/types/station-guidance.types'

const props = defineProps<{ position: BoardingPosition; color?: string | null }>()
const { t } = useI18n()

const CARS = 5
/** The car to ride in, counted from the back of the train. */
const car = computed(() => Math.min(CARS - 1, Math.floor(props.position.fraction * CARS)))
const saves = computed(() => {
  const s = props.position.savesSeconds
  return s >= 60 ? formatDurationLong(s) : formatDurationShort(s)
})
</script>

<template>
  <div class="flex items-center gap-2 text-[11px] text-muted-foreground">
    <svg :viewBox="`0 0 ${CARS * 7 + 2} 6`" class="h-1.5 shrink-0" aria-hidden="true">
      <rect
        v-for="i in CARS"
        :key="i"
        :x="(i - 1) * 7"
        y="0"
        width="6"
        height="6"
        rx="1.5"
        :fill="i - 1 === car ? (color ? `#${color}` : 'currentColor') : 'currentColor'"
        :opacity="i - 1 === car ? 1 : 0.25"
      />
      <path :d="`M${CARS * 7 - 0.5} 1.5 L${CARS * 7 + 1.5} 3 L${CARS * 7 - 0.5} 4.5Z`" fill="currentColor" opacity="0.5" />
    </svg>
    <span>
      <span class="font-medium text-foreground/80">{{ t('directions.station.boardToward', { section: t(`directions.station.section.${position.section}`) }) }}</span>
      · {{ t('directions.station.saves', { duration: saves }) }}
    </span>
  </div>
</template>
