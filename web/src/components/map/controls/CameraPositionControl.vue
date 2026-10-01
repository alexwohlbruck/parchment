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
import { useResponsive } from '@/lib/utils'

const mapService = useMapService()
const { controlSettings } = storeToRefs(useMapStore())
const { camera, onCameraMove } = useMapCamera()
const { isMobileScreen } = useResponsive()

const isVisible = computed(
  () => controlSettings.value.camera === ControlVisibility.ALWAYS,
)
const readout = computed(() => formatCameraReadout(camera.value))
const labels = computed(() =>
  isMobileScreen.value
    ? { pitch: 'p', bearing: 'b' }
    : { pitch: 'pitch', bearing: 'bearing' },
)
const readoutText = computed(() => formatCameraReadoutText(camera.value))

onMounted(() => mapService.on('move', onCameraMove))
onUnmounted(() => mapService.off('move', onCameraMove))
</script>

<template>
  <TransitionFade>
    <div
      v-if="isVisible"
      class="flex min-w-0 items-center gap-1 rounded-md border border-input bg-background py-0.5 pl-1.5 pr-px font-mono text-[10px] leading-tight tabular-nums md:gap-2 md:pl-2 md:text-[11px] text-muted-foreground depth md:h-6 md:py-0"
    >
      <div
        class="flex min-w-0 flex-wrap items-center gap-x-1.5 md:flex-nowrap md:gap-x-2.5"
      >
        <span class="basis-full text-foreground md:basis-auto">
          {{ readout.coordinates }}
        </span>
        <span>z {{ readout.zoom }}</span>
        <span>{{ labels.pitch }} {{ readout.pitch }}</span>
        <span>{{ labels.bearing }} {{ readout.bearing }}</span>
      </div>
      <CopyButton
        :text="readoutText"
        :message="$t('settings.mapSettings.controls.cameraCopied')"
        class="shrink-0 p-0.5!"
      />
    </div>
  </TransitionFade>
</template>
