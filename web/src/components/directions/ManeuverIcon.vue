<script setup lang="ts">
import { computed } from 'vue'
import type { ManeuverKind } from '@/lib/directions/maneuver'
import { maneuverIcon, MANEUVER_ICON_STROKE, MANEUVER_ICON_VIEWBOX, MIRROR_TRANSFORM } from '@/lib/directions/maneuver-icon'

const props = defineProps<{ kind: ManeuverKind; exit?: number }>()

const icon = computed(() => maneuverIcon(props.kind))
</script>

<template>
  <svg
    :viewBox="MANEUVER_ICON_VIEWBOX"
    fill="none"
    stroke="currentColor"
    :stroke-width="MANEUVER_ICON_STROKE"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="icon.d" :transform="icon.mirrored ? MIRROR_TRANSFORM : undefined" />
    <text v-if="kind === 'roundabout' && exit" x="12" y="11.5" text-anchor="middle" font-size="5" stroke="none" fill="currentColor">{{ exit }}</text>
  </svg>
</template>
