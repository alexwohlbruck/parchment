<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ChevronRightIcon } from 'lucide-vue-next'
import { Skeleton } from '@/components/ui/skeleton'
import type { StayMoney, StayRates, StayRoom } from '@server/types/integration.types'

defineProps<{
  rates: StayRates | null
  loading: boolean
}>()

const { t, locale } = useI18n()

function money({ amount, currency }: StayMoney) {
  return new Intl.NumberFormat(locale.value, {
    style: 'currency',
    currency,
    maximumFractionDigits: amount >= 100 ? 0 : 2,
  }).format(amount)
}

function details(room: StayRoom): string[] {
  const until = room.freeCancellationUntil
  return [
    until
      ? t('place.booking.rooms.freeCancel', {
          date: new Date(until).toLocaleDateString(locale.value, { month: 'short', day: 'numeric' }),
        })
      : t('place.booking.rooms.noRefund'),
    room.board,
    room.payAtProperty && t('place.booking.rooms.atHotel', { price: money(room.payAtProperty) }),
  ].filter((part): part is string => !!part)
}
</script>

<template>
  <div class="flex flex-col">
    <template v-if="loading">
      <div v-for="n in 2" :key="n" class="flex justify-between gap-3 py-2">
        <div class="flex flex-col gap-1.5 flex-1">
          <Skeleton class="h-4 w-2/3" />
          <Skeleton class="h-3 w-1/2" />
        </div>
        <Skeleton class="h-4 w-12" />
      </div>
    </template>

    <template v-else-if="rates">
      <p v-if="!rates.rooms.length" class="py-2 text-sm text-muted-foreground">
        {{ t('place.booking.rooms.soldOut') }}
      </p>
      <a
        v-for="room in rates.rooms"
        :key="room.offerId"
        :href="room.bookingUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="group -mx-2 flex items-center gap-3 rounded-md px-2 py-2 hover:bg-accent"
      >
        <div class="flex flex-col min-w-0 flex-1">
          <span class="text-sm font-medium truncate">{{ room.name }}</span>
          <span class="text-xs text-muted-foreground">{{ details(room).join(' · ') }}</span>
        </div>
        <span class="text-sm font-medium tabular-nums">{{ money(room.total) }}</span>
        <ChevronRightIcon class="size-4 text-muted-foreground" />
      </a>
      <a
        v-if="rates.bookingUrl"
        :href="rates.bookingUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="self-start py-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {{ t('place.booking.rooms.allRooms') }}
      </a>
    </template>
  </div>
</template>
