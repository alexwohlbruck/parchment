<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { ChevronRightIcon, NavigationIcon } from 'lucide-vue-next'
import { AppRoute } from '@/router'
import { useGuidanceStore } from '@/stores/guidance.store'
import { useAppStore } from '@/stores/app.store'
import { UnitSystem } from '@/types/map.types'
import { maneuverKind } from '@/lib/directions/maneuver'
import { bannerDistance } from '@/lib/guidance/guidance-display'
import { isAboard } from '@/lib/guidance/guidance-layout'
import { bannerHeadline, bannerRoad } from '@/lib/guidance/instructions/instruction-text'
import { stageHeadline } from '@/lib/guidance/transit-stage-text'
import ManeuverIcon from '@/components/directions/ManeuverIcon.vue'
import RouteBullet from '@/components/transit/bullets/RouteBullet.vue'
import BackgroundGuidance from './BackgroundGuidance.vue'

const { t } = useI18n()
const router = useRouter()
const guidance = useGuidanceStore()
const { unitSystem } = storeToRefs(useAppStore())

// Drawn a tick late so the navigation view has taken its own route line off the map first.
const settled = ref(false)
onMounted(() => (settled.value = true))

const stage = computed(() => (isAboard(guidance.transit) ? guidance.transit : null))
const ride = computed(() => {
  const current = stage.value
  const text = current ? stageHeadline(current, guidance.clockMs, t) : null
  return current && text ? { text, segment: guidance.segments[current.segmentIndex] } : null
})

const progress = computed(() => guidance.progress)
const next = computed(() => progress.value?.next ?? null)
const kind = computed(() => guidance.nextInstruction?.maneuver ?? (next.value ? maneuverKind(next.value.instruction) : 'straight'))
const headline = computed(() => {
  if (!progress.value) return t('guidance.waitingForLocation')
  return bannerHeadline(guidance.status, !progress.value.puck.snapped, t)
})
const distance = computed(() => bannerDistance(progress.value?.distanceToNext ?? 0, unitSystem.value === UnitSystem.METRIC))
const road = computed(() =>
  next.value ? bannerRoad(next.value.instruction, kind.value, guidance.nextInstruction, guidance.destinationLabel, t) : '',
)

function resume() {
  router.push({ name: AppRoute.GUIDANCE })
}
</script>

<template>
  <button
    type="button"
    class="nav-card flex h-14 w-full items-center gap-3 rounded-full pl-4 pr-3 text-left active:scale-[0.98] transition-transform"
    :aria-label="t('guidance.resume')"
    @click="resume"
  >
    <template v-if="ride">
      <RouteBullet
        size="md"
        class="shrink-0"
        :label="ride.segment?.lineName ?? ''"
        :color="ride.segment?.lineColor"
        :text-color="ride.segment?.lineTextColor"
      />
      <span class="min-w-0 flex-1 truncate font-semibold">{{ ride.text }}</span>
    </template>
    <template v-else-if="next && !headline">
      <ManeuverIcon :kind="kind" :exit="next.instruction.exitNumber" class="size-8 shrink-0" />
      <span class="min-w-0 flex-1 truncate font-semibold">
        <span class="tabular-nums">{{ distance.value }} {{ t(`guidance.units.${distance.unit}`) }}</span>
        <span class="text-muted-foreground"> · </span>{{ road }}
      </span>
    </template>
    <template v-else>
      <NavigationIcon class="size-5 shrink-0 text-primary" />
      <span class="min-w-0 flex-1 truncate font-semibold">{{ headline ?? t('guidance.resume') }}</span>
    </template>
    <ChevronRightIcon class="size-5 shrink-0 text-muted-foreground" />
  </button>
  <BackgroundGuidance v-if="settled" />
</template>
