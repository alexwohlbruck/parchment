<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ChevronDownIcon, LayersIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import ResponsiveDropdown from '@/components/responsive/ResponsiveDropdown.vue'
import { geoExportItems } from '@/components/geo-file/geo-export-items'
import { AppRoute } from '@/router'
import { useAuthStore } from '@/stores/auth.store'
import { useMapToolsStore } from '@/stores/map-tools.store'
import { useCanvasesService } from '@/services/library/canvases.service'
import { canvasCollection } from '@/lib/canvas/canvas-geo'
import { exportGeoFile } from '@/lib/geo-file/geo-write'
import type { GeoFormat } from '@/lib/geo-file/geo-format'
import { themeColorToHex } from '@/lib/utils'
import { emptyCanvasBody, type CanvasAnnotation } from '@/types/canvas.types'

const props = defineProps<{
  annotations: CanvasAnnotation[]
  /** What the new canvas and the exported file are called. */
  name: string
}>()

const { t } = useI18n()
const router = useRouter()
const authStore = useAuthStore()
const mapToolsStore = useMapToolsStore()
const canvasesService = useCanvasesService()

const saving = ref(false)
const signedIn = computed(() => !!authStore.me)

async function saveToCanvas() {
  if (saving.value) return
  saving.value = true
  try {
    const canvas = await canvasesService.createCanvasWith(
      { name: props.name },
      { ...emptyCanvasBody(), annotations: props.annotations },
    )
    if (!canvas) return
    mapToolsStore.setActiveTool('none')
    router.push({ name: AppRoute.CANVAS_EDITOR, params: { id: canvas.id } })
  } finally {
    saving.value = false
  }
}

function exportFile(format: GeoFormat) {
  exportGeoFile(
    canvasCollection({ annotations: props.annotations, layers: [] }, themeColorToHex),
    props.name,
    format,
  )
}

const exportItems = computed(() => geoExportItems(t, exportFile))
</script>

<template>
  <div class="flex gap-1.5 pt-1">
    <Button
      v-if="signedIn"
      size="sm"
      class="h-8 flex-1 gap-1.5 max-md:h-10"
      :disabled="saving"
      @click="saveToCanvas"
    >
      <Spinner v-if="saving" size="icon" />
      <LayersIcon v-else class="size-3.5" />
      {{ t('measure.saveToCanvas') }}
    </Button>
    <ResponsiveDropdown :items="exportItems" align="end" :title="t('geoFile.export')">
      <template #trigger="{ open }">
        <Button
          variant="outline"
          size="sm"
          class="h-8 gap-1 pr-2 max-md:h-10"
          :class="{ 'flex-1': !signedIn }"
          @click="open"
        >
          {{ t('geoFile.export') }}
          <ChevronDownIcon class="size-3.5 text-muted-foreground" />
        </Button>
      </template>
    </ResponsiveDropdown>
  </div>
</template>
