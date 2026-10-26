<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import ManeuverIcon from '@/components/directions/ManeuverIcon.vue'
import { maneuverKind } from '@/lib/directions/maneuver'
import { useDistanceLabel } from '@/composables/guidance/useDistanceLabel'
import { useRoutePreviewStore } from '@/stores/route-preview.store'

const props = defineProps<{ metric: boolean }>()
const distanceLabel = useDistanceLabel(() => props.metric)
const preview = useRoutePreviewStore()
const list = ref<HTMLElement | null>(null)

watch(
  () => preview.stepIndex,
  async index => {
    await nextTick()
    list.value?.querySelector(`[data-step="${index}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  },
)
</script>

<template>
  <ol ref="list" class="space-y-0.5">
    <li v-for="step in preview.steps" :key="step.index" :data-step="step.index">
      <button
        type="button"
        class="flex w-full items-center gap-3.5 rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
        :class="{ 'bg-muted': step.index === preview.stepIndex }"
        @click="preview.select(step.index)"
      >
        <ManeuverIcon :kind="maneuverKind(step.instruction)" :exit="step.instruction.exitNumber" class="size-6 shrink-0" />
        <span class="min-w-0 flex-1 text-[15px] leading-snug">{{ step.instruction.text }}</span>
        <span v-if="step.index > 0" class="shrink-0 text-sm text-muted-foreground tabular-nums">
          {{ distanceLabel(step.startDistance) }}
        </span>
      </button>
    </li>
  </ol>
</template>
