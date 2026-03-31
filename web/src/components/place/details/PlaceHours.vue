<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ClockIcon } from 'lucide-vue-next'
import DetailItem from './DetailItem.vue'
import type { OpeningHours } from '@/types/place.types'

const props = defineProps<{
  hours: OpeningHours
  osmUrl?: string
}>()

const { t } = useI18n()

const showHours = ref(false)

const DAYS = computed(() => [0, 1, 2, 3, 4, 5, 6].map(i => t(`place.hours.days.${i}`)))

const hasHoursData = computed(() => {
  const hours = props.hours
  return (
    hours.regularHours.length > 0 ||
    hours.isOpen24_7 ||
    hours.isPermanentlyClosed ||
    hours.isTemporarilyClosed ||
    hours.rawText
  )
})

const openingStatus = computed(() => {
  const hours = props.hours

  if (!hasHoursData.value) {
    return { status: '', color: '' }
  }

  if (hours.isPermanentlyClosed) {
    return { status: t('place.hours.permanentlyClosed'), color: 'text-red-500' }
  }

  if (hours.isTemporarilyClosed) {
    return { status: t('place.hours.temporarilyClosed'), color: 'text-orange-500' }
  }

  if (hours.isOpen24_7) {
    return { status: t('place.hours.open247'), color: 'text-green-500' }
  }

  if (hours.regularHours.length === 0) {
    // No parsed hours — show raw text if available so the row isn't blank
    return hours.rawText
      ? { status: hours.rawText.split(';').map(s => s.trim()).join(' · '), color: '' }
      : { status: '', color: '' }
  }

  const now = new Date()
  const currentDay = now.getDay()
  const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now
    .getMinutes()
    .toString()
    .padStart(2, '0')}`

  const todayHours = hours.regularHours.find(h => h.day === currentDay)
  if (!todayHours) {
    return { status: t('place.hours.closedToday'), color: 'text-red-500' }
  }

  if (currentTime >= todayHours.open && currentTime <= todayHours.close) {
    return {
      status: t('place.hours.openUntil', { time: formatTime(todayHours.close) }),
      color: 'text-green-500',
    }
  } else if (currentTime < todayHours.open) {
    return {
      status: t('place.hours.opensAt', { time: formatTime(todayHours.open) }),
      color: 'text-orange-500',
    }
  } else {
    let nextDay = (currentDay + 1) % 7
    let daysChecked = 0
    while (daysChecked < 7) {
      const nextDayHours = hours.regularHours.find(h => h.day === nextDay)
      if (nextDayHours) {
        return {
          status: t('place.hours.opensDay', { day: DAYS.value[nextDay], time: formatTime(nextDayHours.open) }),
          color: 'text-orange-500',
        }
      }
      nextDay = (nextDay + 1) % 7
      daysChecked++
    }
    return { status: t('place.hours.closed'), color: 'text-red-500' }
  }
})

function formatTime(time: string) {
  const [hours, minutes] = time.split(':').map(Number)
  const period = hours >= 12 ? 'PM' : 'AM'
  const hour = hours % 12 || 12
  return `${hour}:${minutes.toString().padStart(2, '0')} ${period}`
}

function formatOpeningHours(hours: OpeningHours) {
  if (!hours || !hours.rawText) return ''

  if (hours.isPermanentlyClosed) return t('place.hours.permanentlyClosed')
  if (hours.isTemporarilyClosed) {
    return hours.nextOpenDate
      ? t('place.hours.temporarilyClosedUntil', { date: new Date(hours.nextOpenDate).toLocaleDateString() })
      : t('place.hours.temporarilyClosed')
  }
  if (hours.isOpen24_7) return t('place.hours.open247')

  return hours.rawText.split(';').join('\n')
}
</script>

<template>
  <DetailItem
    v-if="hasHoursData && openingStatus.status"
    :icon="ClockIcon"
    :osmUrl="osmUrl"
    :copyValue="formatOpeningHours(hours)"
  >
    <div class="flex flex-col">
      <div v-if="openingStatus.status" class="flex items-center gap-2">
        <span :class="openingStatus.color">{{ openingStatus.status }}</span>
        <button
          v-if="hours.regularHours.length > 0"
          class="text-sm text-muted-foreground hover:text-foreground text-left"
          @click="showHours = !showHours"
        >
          {{ t('place.hours.seeHours') }}
        </button>
      </div>
      <div v-show="showHours" class="text-sm text-muted-foreground mt-1">
        <div
          v-for="(day, index) in DAYS"
          :key="day"
          class="flex justify-between"
          :class="{ 'font-medium': index === new Date().getDay() }"
        >
          <span>{{ day }}:</span>
          <span>
            <template v-if="hours.regularHours.find(h => h.day === index)">
              {{ formatTime(hours.regularHours.find(h => h.day === index)!.open) }}
              -
              {{ formatTime(hours.regularHours.find(h => h.day === index)!.close) }}
            </template>
            <template v-else>{{ t('place.hours.closed') }}</template>
          </span>
        </div>
      </div>
    </div>
  </DetailItem>
</template>
