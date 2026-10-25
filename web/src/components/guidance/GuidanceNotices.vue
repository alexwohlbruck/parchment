<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatDurationCompact } from '@/lib/time-format'
import { useGuidanceStore } from '@/stores/guidance.store'
import AlternativeOffer from './AlternativeOffer.vue'
import SegmentHandoff from './SegmentHandoff.vue'
import DockWatchCard from './DockWatchCard.vue'
import { useGuidanceContext } from './context'

const { t } = useI18n()
const guidance = useGuidanceStore()
const { alternatives, itinerary, docks } = useGuidanceContext()

const offer = computed(() => {
  const better = itinerary.offer.value
  if (better) {
    return {
      key: `itinerary:${better.from}:${better.gainMs}`,
      headline: t('guidance.itinerary.sooner', { duration: formatDurationCompact(better.gainMs / 1000) }),
      detail: better.lines.length ? t('guidance.itinerary.take', { lines: better.lines.join(' → ') }) : null,
      seconds: itinerary.offerSeconds,
      accept: () => itinerary.accept(),
      dismiss: () => itinerary.dismiss(),
    }
  }
  const route = alternatives.offer.value
  if (!route) return null
  return {
    key: `route:${route.segmentIndex}:${route.route.duration}`,
    headline: route.reason === 'faster'
      ? t('guidance.alternatives.faster', { duration: formatDurationCompact(route.saved) })
      : t(`guidance.alternatives.${route.reason}`),
    detail: route.via ? t('guidance.alternatives.via', { street: route.via }) : null,
    seconds: alternatives.offerSeconds,
    accept: () => alternatives.accept(),
    dismiss: () => alternatives.dismiss(),
  }
})

const NOTICE = 'nav-surface pointer-events-auto rounded-3xl bg-background/95 p-3.5 shadow-xl ring-1 ring-foreground/5 backdrop-blur-md'

const showDocks = computed(() => !!docks.watched.value && guidance.status !== 'arrived')
</script>

<template>
  <TransitionGroup
    tag="div"
    class="flex flex-col gap-2"
    enter-active-class="transition duration-250 ease-out"
    enter-from-class="opacity-0 translate-y-2"
    leave-active-class="transition duration-150 ease-in"
    leave-to-class="opacity-0"
  >
    <div v-if="guidance.handoff" :key="`handoff:${guidance.handoff.from}`" :class="NOTICE">
      <SegmentHandoff :handoff="guidance.handoff" @settle="guidance.settleHandoff()" />
    </div>
    <div v-if="offer" :key="offer.key" :class="NOTICE">
      <AlternativeOffer
        :headline="offer.headline"
        :detail="offer.detail"
        :seconds="offer.seconds"
        @accept="offer.accept"
        @dismiss="offer.dismiss"
      />
    </div>
    <div v-if="showDocks && docks.watched.value" key="docks" :class="NOTICE">
      <DockWatchCard
        :need="docks.watched.value.need"
        :name="docks.watched.value.name"
        :station="docks.station.value"
        :risk="docks.risk.value"
        :alternative="docks.alternative.value"
        :dismissed="docks.dismissed.value"
        :switching="docks.switching.value"
        @accept="docks.accept()"
        @dismiss="docks.dismiss()"
      />
    </div>
  </TransitionGroup>
</template>
