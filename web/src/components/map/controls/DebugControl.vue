<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { TransitionFade } from '@morev/vue-transitions'
import { useMapStore } from '@/stores/map.store'
import { useMapService } from '@/services/map/map.service'
import { useMapCamera } from '@/composables/map/useMapCamera'
import { ControlVisibility } from '@/types/map.types'
import {
  formatCameraReadout,
  formatCameraReadoutText,
} from '@/lib/map/map-camera'
import CopyButton from '@/components/CopyButton.vue'

const mapService = useMapService()
const { controlSettings } = storeToRefs(useMapStore())
const { camera, onCameraMove } = useMapCamera()

const isVisible = computed(
  () => controlSettings.value.debug === ControlVisibility.ALWAYS,
)
const readout = computed(() => formatCameraReadout(camera.value))
const readoutText = computed(() => formatCameraReadoutText(camera.value))

onMounted(() => mapService.on('move', onCameraMove))
onUnmounted(() => mapService.off('move', onCameraMove))
</script>

<template>
  <TransitionFade>
    <div
      v-if="isVisible"
      class="flex h-6 items-center gap-2.5 rounded-md border border-input bg-background pl-2 pr-px font-mono text-[11px] tabular-nums text-muted-foreground depth"
    >
      <span class="text-foreground">{{ readout.coordinates }}</span>
      <span>z {{ readout.zoom }}</span>
      <span>pitch {{ readout.pitch }}</span>
      <span>bearing {{ readout.bearing }}</span>
      <CopyButton
        :text="readoutText"
        :message="$t('settings.mapSettings.controls.debugCopied')"
        class="p-0.5!"
      />
    </div>
  </TransitionFade>
</template>
