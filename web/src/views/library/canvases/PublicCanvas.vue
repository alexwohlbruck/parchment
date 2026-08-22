<script setup lang="ts">
/**
 * A canvas someone shared by link, read-only.
 *
 * Reachable signed out — that is the whole point of a public link — so it
 * fetches through the unauthenticated endpoint and never touches the canvases
 * store. Its layers render exactly as they do for the owner, because they go
 * through the same renderer; nothing here can edit them.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCanvasesService } from '@/services/library/canvases.service'
import { useCanvasRendering } from '@/composables/useCanvasRendering'
import DetailPanelLayout from '@/components/layouts/DetailPanelLayout.vue'
import CanvasLayerRow from '@/components/library/canvas/CanvasLayerRow.vue'
import { ItemIcon } from '@/components/ui/item-icon'
import { Spinner } from '@/components/ui/spinner'
import { EmptyState } from '@/components/ui/empty-state'
import type { ThemeColor } from '@/lib/utils'
import { emptyCanvasBody, type Canvas } from '@/types/canvas.types'
import { LinkIcon } from 'lucide-vue-next'

const props = defineProps<{ token: string }>()

const { t } = useI18n()
const canvasesService = useCanvasesService()

const canvas = ref<Canvas | null>(null)
const loading = ref(true)

;(async () => {
  canvas.value = await canvasesService.fetchPublicCanvas(props.token)
  loading.value = false
})()

useCanvasRendering(
  computed(() =>
    canvas.value
      ? [{ id: canvas.value.id, body: canvas.value.body ?? emptyCanvasBody() }]
      : [],
  ),
  { key: 'public-canvas' },
)

const layers = computed(() => canvas.value?.body?.layers ?? [])
</script>

<template>
  <DetailPanelLayout>
    <template #title>
      <p class="text-lg font-semibold truncate">
        {{ canvas?.name || t('canvases.dialog.namePlaceholder') }}
      </p>
    </template>

    <div v-if="loading" class="py-12 flex justify-center">
      <Spinner />
    </div>

    <div v-else-if="!canvas" class="py-12">
      <EmptyState
        :icon="LinkIcon"
        :title="t('canvases.public.gone.title')"
        :description="t('canvases.public.gone.description')"
      />
    </div>

    <div v-else class="space-y-3">
      <div class="flex items-center gap-2.5">
        <ItemIcon
          :icon="canvas.icon ?? 'MapIcon'"
          :color="(canvas.iconColor as ThemeColor) ?? 'iris'"
          size="md"
        />
        <p class="text-sm text-muted-foreground flex-1 min-w-0">
          {{ canvas.description || t('canvases.public.subtitle') }}
        </p>
      </div>

      <div v-if="layers.length" class="space-y-1.5">
        <CanvasLayerRow
          v-for="layer in layers"
          :key="layer.id"
          :layer="layer"
          readonly
        />
      </div>
    </div>
  </DetailPanelLayout>
</template>
