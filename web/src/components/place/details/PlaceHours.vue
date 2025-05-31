<script setup lang="ts">
import { ref, computed } from 'vue'
import { ClockIcon } from 'lucide-vue-next'
import DetailItem from './DetailItem.vue'
import type { OpeningHours } from '@/types/place.types'

const props = defineProps<{
  hours: OpeningHours
  osmUrl?: string
}>()

const showHours = ref(false)

const DAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

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
    return { status: 'Permanently closed', color: 'text-red-500' }
  }

  if (hours.isTemporarilyClosed) {
    return { status: 'Temporarily closed', color: 'text-orange-500' }
  }

  if (hours.isOpen24_7) {
    return { status: 'Open 24/7', color: 'text-green-500' }
  }

  if (hours.regularHours.length === 0) {
    return { status: '', color: '' }
  }

  const now = new Date()
  const currentDay = now.getDay()
  const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now
    .getMinutes()
    .toString()
    .padStart(2, '0')}`

  const todayHours = hours.regularHours.find(h => h.day === currentDay)
  if (!todayHours) {
    return { status: 'Closed today', color: 'text-red-500' }
  }

  if (currentTime >= todayHours.open && currentTime <= todayHours.close) {
    return {
      status: `Open until ${formatTime(todayHours.close)}`,
      color: 'text-green-500',
    }
  } else if (currentTime < todayHours.open) {
    return {
      status: `Opens at ${formatTime(todayHours.open)}`,
      color: 'text-orange-500',
    }
  } else {
    // Find next day's opening time
    let nextDay = (currentDay + 1) % 7
    let daysChecked = 0
    while (daysChecked < 7) {
      const nextDayHours = hours.regularHours.find(h => h.day === nextDay)
      if (nextDayHours) {
        return {
          status: `Opens ${DAYS[nextDay]} at ${formatTime(nextDayHours.open)}`,
          color: 'text-orange-500',
        }
      }
      nextDay = (nextDay + 1) % 7
      daysChecked++
    }
    return { status: 'Closed', color: 'text-red-500' }
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

  if (hours.isPermanentlyClosed) return 'Permanently closed'
  if (hours.isTemporarilyClosed) {
    return hours.nextOpenDate
      ? `Temporarily closed until ${new Date(
          hours.nextOpenDate,
        ).toLocaleDateString()}`
      : 'Temporarily closed'
  }
  if (hours.isOpen24_7) return 'Open 24/7'

  return hours.rawText.split(';').join('\n')
}
</script>

<template>
  <DetailItem
    v-if="hasHoursData"
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
          See hours
        </button>
      </div>
      <div v-show="showHours" class="text-sm text-muted-foreground mt-1">
        <div
          v-for="day in DAYS"
          :key="day"
          class="flex justify-between"
          :class="{ 'font-medium': day === DAYS[new Date().getDay()] }"
        >
          <span>{{ day }}:</span>
          <span>
            <template
              v-if="hours.regularHours.find(h => h.day === DAYS.indexOf(day))"
            >
              {{
                formatTime(
                  hours.regularHours.find(h => h.day === DAYS.indexOf(day))!
                    .open,
                )
              }}
              -
              {{
                formatTime(
                  hours.regularHours.find(h => h.day === DAYS.indexOf(day))!
                    .close,
                )
              }}
            </template>
            <template v-else> Closed </template>
          </span>
        </div>
      </div>
    </div>
  </DetailItem>
</template>
