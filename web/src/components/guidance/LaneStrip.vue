<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import ManeuverIcon from '@/components/directions/ManeuverIcon.vue'
import type { ManeuverKind } from '@/lib/directions/maneuver'
import type { LaneArrow, LanePlan } from '@/lib/guidance/lanes'

defineProps<{ plan: LanePlan }>()
const { t } = useI18n()

const ICON: Record<LaneArrow, ManeuverKind> = {
  left: 'left',
  'slight-left': 'slight-left',
  through: 'straight',
  'slight-right': 'slight-right',
  right: 'right',
  uturn: 'uturn',
}
</script>

<template>
  <div class="flex items-center justify-center gap-1 bg-white/10 px-3 py-1.5" role="img" :aria-label="t('guidance.lanes.label')">
    <div
      v-for="(lane, i) in plan.lanes"
      :key="i"
      class="relative flex size-9 items-center justify-center rounded-md"
      :class="[lane.recommended ? 'bg-white/20' : '', lane.valid ? 'text-white' : 'text-white/30']"
    >
      <ManeuverIcon
        v-for="arrow in lane.arrows"
        :key="arrow"
        :kind="ICON[arrow]"
        class="absolute size-6"
      />
    </div>
  </div>
</template>
