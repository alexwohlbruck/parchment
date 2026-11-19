<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { DownloadIcon, LayersIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { AppRoute } from '@/router'
import { useAuthStore } from '@/stores/auth.store'
import { useMapToolsStore } from '@/stores/map-tools.store'
import { useCanvasesService } from '@/services/library/canvases.service'
import {
  canvasCollection,
  geoJsonBlob,
  geoJsonFilename,
} from '@/lib/canvas/geo-export'
import { saveFile } from '@/lib/file-save'
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

function exportFile() {
  const collection = canvasCollection(
    { annotations: props.annotations, layers: [] },
    themeColorToHex,
  )
  saveFile(geoJsonBlob(collection), geoJsonFilename(props.name))
}
</script>

<template>
  <div class="flex gap-1.5">
    <Button
      v-if="signedIn"
      size="sm"
      class="h-7 flex-1"
      :disabled="saving"
      @click="saveToCanvas"
    >
      <Spinner v-if="saving" size="icon" />
      <LayersIcon v-else class="size-3.5" />
      {{ t('measure.saveToCanvas') }}
    </Button>
    <Button
      variant="outline"
      size="sm"
      class="h-7"
      :class="{ 'flex-1': !signedIn }"
      @click="exportFile"
    >
      <DownloadIcon class="size-3.5" />
      {{ t('measure.export') }}
    </Button>
  </div>
</template>
