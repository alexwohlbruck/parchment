<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useSheetPeek } from '@/composables/sheet/useSheetPeek'
import { useGuidanceStore } from '@/stores/guidance.store'
import GuidanceEta from './GuidanceEta.vue'
import ArrivalPanel from './ArrivalPanel.vue'
import { useGuidanceContext } from './context'

defineProps<{ expanded: boolean }>()
const emit = defineEmits<{ toggle: [] }>()
const { t } = useI18n()
const guidance = useGuidanceStore()
const { exit, metric } = useGuidanceContext()
const { peekRef } = useSheetPeek()

const TAP_SLOP_PX = 10
let downY: number | null = null
function onPointerDown(event: PointerEvent) {
  downY = event.clientY
}
function onClick(event: MouseEvent) {
  const moved = downY != null && Math.abs(event.clientY - downY) > TAP_SLOP_PX
  if (!moved && !(event.target as Element).closest('button')) emit('toggle')
}
</script>

<template>
  <div ref="peekRef" class="px-5 pb-4 pt-2" :aria-expanded="expanded" @pointerdown="onPointerDown" @click="onClick">
    <button
      class="mx-auto mb-2 flex h-4 w-12 items-center justify-center"
      :aria-label="expanded ? t('guidance.menu.hide') : t('guidance.menu.show')"
      @click="emit('toggle')"
    >
      <span class="h-1.5 w-10 rounded-full bg-muted-foreground/30" />
    </button>
    <ArrivalPanel
      v-if="guidance.status === 'arrived'"
      :destination="guidance.destinationLabel"
      :has-next-leg="guidance.nextLeg != null"
      @done="exit"
      @next="guidance.startNextLeg()"
    />
    <GuidanceEta v-else :progress="guidance.progress" :metric="metric" @exit="exit" />
  </div>
</template>
