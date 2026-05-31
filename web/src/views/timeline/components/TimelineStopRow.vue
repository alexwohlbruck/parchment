<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import dayjs from 'dayjs'
import duration from 'dayjs/plugin/duration'
import localizedFormat from 'dayjs/plugin/localizedFormat'
import type { LocationHistoryStop } from '@server/types/location-history.types'

dayjs.extend(duration)
dayjs.extend(localizedFormat)

const props = defineProps<{
  stop: LocationHistoryStop
  isLast?: boolean
}>()

const emit = defineEmits<{
  (e: 'select', stop: LocationHistoryStop): void
}>()

const { t } = useI18n()

const timeLabel = computed(() =>
  dayjs(props.stop.startTime).format('h:mm A'),
)

const durationLabel = computed(() => {
  const totalMin = Math.max(1, Math.round(props.stop.duration / 60))
  if (totalMin < 60) return `${totalMin}m`
  const hours = Math.floor(totalMin / 60)
  const min = totalMin % 60
  return min === 0 ? `${hours}h` : `${hours}h ${min}m`
})

const displayName = computed(
  () => props.stop.name?.trim() || t('timeline.unnamedStop'),
)

const category = computed(() => props.stop.category ?? null)
</script>

<template>
  <div
    class="tl-event group"
    :class="{ 'is-last': isLast }"
    data-kind="place"
    @click="emit('select', stop)"
  >
    <div class="time">{{ timeLabel }}</div>
    <div class="title">{{ displayName }}</div>
    <div class="meta">
      <span>{{ durationLabel }}</span>
      <template v-if="category">
        <span class="dot" />
        <span>{{ category }}</span>
      </template>
    </div>
  </div>
</template>
