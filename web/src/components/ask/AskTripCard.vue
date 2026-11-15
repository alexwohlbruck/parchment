<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { ArrowRightIcon } from 'lucide-vue-next'
import TripsList from '@/components/directions/TripsList.vue'
import { Button } from '@/components/ui/button'
import { ITEM_ROW_SURFACES } from '@/components/ui/item-row'
import { AppRoute } from '@/router'
import type { AskTripPlan } from '@/stores/ask.store'

const props = defineProps<{ plan: AskTripPlan }>()

const { t } = useI18n()
const router = useRouter()

const proposed = computed(() => ({
  ...props.plan.trips,
  trips: props.plan.trips.trips.filter(trip => trip.id === props.plan.tripId),
}))
</script>

<template>
  <div :class="ITEM_ROW_SURFACES.row" class="overflow-hidden">
    <TripsList :trips="proposed" />
    <Button
      variant="ghost"
      size="sm"
      class="m-1 text-muted-foreground"
      @click="router.push({ name: AppRoute.DIRECTIONS })"
    >
      {{ t('ask.trip.allWays') }}
      <ArrowRightIcon class="size-4" />
    </Button>
  </div>
</template>
