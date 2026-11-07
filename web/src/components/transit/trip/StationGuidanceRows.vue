<script setup lang="ts">
import { computed } from 'vue'
import TransferChip from './TransferChip.vue'
import StationWalkSteps from './StationWalkSteps.vue'
import { platformSpot, stationWalksAt, transferAt } from '@/lib/transit/station/station-walks'
import { stationSign, type SignedSegment } from '@/lib/transit/station/station-signs'

const props = defineProps<{ segments: SignedSegment[]; index: number }>()

const transfer = computed(() => transferAt(props.segments, props.index))
const walks = computed(() =>
  stationWalksAt(props.segments, props.index)
    .map(placed => ({
      ...placed,
      sign: stationSign(props.segments, placed),
      spot: platformSpot(props.segments, placed.kind, placed.ride),
    }))
    .filter(w => w.kind !== 'transfer' || w.sign || (!w.walk.estimate && w.walk.steps?.length)),
)
</script>

<template>
  <div v-if="transfer || walks.length" class="flex flex-col items-start gap-1.5">
    <TransferChip v-if="transfer" :transfer="transfer" />
    <StationWalkSteps
      v-for="placed in walks"
      :key="`${placed.kind}-${placed.ride}`"
      :walk="placed.walk"
      :sign="placed.sign"
      :spot="placed.spot"
      :timed="placed.kind !== 'transfer'"
    />
  </div>
</template>
