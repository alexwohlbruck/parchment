<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import RouteBullet from '@/components/transit/bullets/RouteBullet.vue'
import { formatClock } from '@/lib/directions/trip-display'
import { getRouteTypeKey } from '@/lib/transit/transit'
import type { VehicleQuestion } from '@/composables/guidance/useVehicleSwitch'
import type { VehicleCandidate } from '@/lib/guidance/vehicle-switch'

defineProps<{ question: VehicleQuestion }>()
defineEmits<{ answer: [candidate: VehicleCandidate | null] }>()
const { t } = useI18n()
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="font-medium leading-snug">{{ t(`guidance.transit.whichVehicle.${getRouteTypeKey(question.routeType)}`) }}</div>
    <div class="flex flex-col">
      <button
        v-for="{ candidate } in question.options"
        :key="candidate.tripId"
        class="-mx-2 flex h-12 items-center gap-2.5 rounded-xl px-2 text-left transition-colors hover:bg-accent active:bg-accent"
        @click="$emit('answer', candidate)"
      >
        <RouteBullet size="md" class="shrink-0" :label="candidate.line" :color="candidate.color" :text-color="candidate.textColor" />
        <span class="min-w-0 flex-1 truncate text-sm">{{ candidate.headsign }}</span>
        <span class="shrink-0 text-sm text-muted-foreground tabular-nums">{{ formatClock(new Date(candidate.departureMs)) }}</span>
      </button>
    </div>
    <button class="self-start text-sm text-muted-foreground hover:text-foreground" @click="$emit('answer', null)">
      {{ t('guidance.transit.noneOfThese') }}
    </button>
  </div>
</template>
