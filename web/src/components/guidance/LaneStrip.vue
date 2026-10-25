<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import ManeuverIcon from '@/components/directions/ManeuverIcon.vue'
import type { ManeuverKind } from '@/lib/directions/maneuver'
import type { LaneArrow, LanePlan } from '@/lib/guidance/lanes'

defineProps<{ plan: LanePlan; dash?: boolean }>()
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
  <div class="flex items-center justify-center gap-1 border-t bg-muted/60 px-3 py-2" role="img" :aria-label="t('guidance.lanes.label')">
    <div
      v-for="(lane, i) in plan.lanes"
      :key="i"
      class="relative flex items-center justify-center rounded-lg"
      :class="[dash ? 'size-12' : 'size-10', lane.recommended && 'bg-foreground/15', lane.valid ? 'text-foreground' : 'text-foreground/30']"
    >
      <ManeuverIcon
        v-for="arrow in lane.arrows"
        :key="arrow"
        :kind="ICON[arrow]"
        class="absolute"
        :class="dash ? 'size-8' : 'size-7'"
      />
    </div>
  </div>
</template>
