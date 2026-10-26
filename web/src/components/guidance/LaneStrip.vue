<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { ManeuverKind } from '@/lib/directions/maneuver'
import { MIRROR_TRANSFORM } from '@/lib/directions/maneuver-icon'
import { laneStrokes } from '@/lib/guidance/lane-glyph'
import type { LanePlan } from '@/lib/guidance/lanes'

defineProps<{ plan: LanePlan; kind: ManeuverKind; dash?: boolean }>()
const { t } = useI18n()
</script>

<template>
  <div
    class="flex items-center justify-center gap-1 border-t"
    :class="dash ? 'px-5 py-2.5' : 'px-4 py-2'"
    role="img"
    :aria-label="t('guidance.lanes.label')"
  >
    <svg
      v-for="(lane, i) in plan.lanes"
      :key="i"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="shrink-0"
      :class="dash ? 'size-10' : 'size-9'"
      aria-hidden="true"
    >
      <path
        v-for="stroke in laneStrokes(lane, kind)"
        :key="stroke.arrow"
        :d="stroke.d"
        :transform="stroke.mirrored ? MIRROR_TRANSFORM : undefined"
        :class="stroke.lit ? 'text-foreground' : 'text-foreground/25'"
      />
    </svg>
  </div>
</template>
