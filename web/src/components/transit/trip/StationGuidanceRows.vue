<script setup lang="ts">
import { computed } from 'vue'
import TransferChip from './TransferChip.vue'
import StationWalkSteps from './StationWalkSteps.vue'
import { stationWalksAt, transferAt, type GuidedSegment } from '@/lib/transit/station/station-walks'

const props = defineProps<{ segments: GuidedSegment[]; index: number }>()

const transfer = computed(() => transferAt(props.segments, props.index))
/** A change's time is on its chip, so its walk only adds the steps. */
const walks = computed(() =>
  stationWalksAt(props.segments, props.index).filter(w => w.kind !== 'transfer' || (!w.walk.estimate && w.walk.steps?.length)),
)
</script>

<template>
  <div v-if="transfer || walks.length" class="flex flex-col items-start gap-1.5">
    <TransferChip v-if="transfer" :transfer="transfer" />
    <StationWalkSteps
      v-for="placed in walks"
      :key="`${placed.kind}-${placed.ride}`"
      :walk="placed.walk"
      :timed="placed.kind !== 'transfer'"
    />
  </div>
</template>
