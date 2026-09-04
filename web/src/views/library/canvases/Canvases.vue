<script setup lang="ts">
/**
 * The Canvases tab: the user's own maps, each toggleable onto the main map.
 */
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useCanvasesStore } from '@/stores/library/canvases.store'
import { useCanvasesService } from '@/services/library/canvases.service'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import CanvasCard from '@/components/library/CanvasCard.vue'
import CanvasDialog from '@/components/library/canvas/CanvasDialog.vue'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { MapIcon, PlusIcon, SearchIcon } from 'lucide-vue-next'
import type { Canvas } from '@/types/canvas.types'

const { t } = useI18n()
const router = useRouter()
const canvasesStore = useCanvasesStore()
const canvasesService = useCanvasesService()
const { canvases } = storeToRefs(canvasesStore)

const loading = ref(canvases.value.length === 0)
const dialogOpen = ref(false)
const editing = ref<Canvas | null>(null)
const searchQuery = ref('')

onMounted(async () => {
  await canvasesService.fetchCanvases()
  loading.value = false
})

const sorted = computed(() =>
  [...canvases.value].sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  ),
)

const filtered = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return sorted.value
  return sorted.value.filter(canvas =>
    (canvas.name ?? '').toLowerCase().includes(q),
  )
})

function create() {
  editing.value = null
  dialogOpen.value = true
}

function rename(canvas: Canvas) {
  editing.value = canvas
  dialogOpen.value = true
}

function openCreated(canvas: Canvas) {
  router.push({ name: AppRoute.CANVAS_EDITOR, params: { id: canvas.id } })
}
</script>

<template>
  <CanvasDialog
    v-model:open="dialogOpen"
    :canvas="editing"
    @created="openCreated"
  />

  <div v-if="loading" class="flex-1 flex items-center justify-center py-12">
    <Spinner />
  </div>

  <div
    v-else-if="!sorted.length"
    class="h-full flex items-start justify-center p-4"
  >
    <EmptyState
      :icon="MapIcon"
      :title="t('canvases.empty.title')"
      :description="t('canvases.empty.description')"
      class="mt-20"
    >
      <Button size="sm" variant="outline" class="gap-1.5" @click="create">
        <PlusIcon class="size-3" />
        {{ t('canvases.actions.new') }}
      </Button>
    </EmptyState>
  </div>

  <div v-else class="h-full flex flex-col gap-2">
    <div class="flex items-center gap-2">
      <div class="relative flex-1">
        <SearchIcon
          class="absolute left-2.5 top-3 size-4 text-muted-foreground"
        />
        <Input
          v-model="searchQuery"
          class="w-full pl-8"
          :placeholder="t('canvases.search.placeholder')"
        />
      </div>
      <Button
        variant="outline"
        size="icon"
        class="h-10 w-10"
        :aria-label="t('canvases.actions.new')"
        :title="t('canvases.actions.new')"
        @click="create"
      >
        <PlusIcon class="h-4 w-4" />
      </Button>
    </div>

    <div v-if="filtered.length" class="flex flex-col gap-2 pb-4">
      <CanvasCard
        v-for="canvas in filtered"
        :key="canvas.id"
        :canvas="canvas"
        class="w-full"
        @rename="rename"
      />
    </div>

    <div v-else class="text-center py-8 text-muted-foreground">
      <p class="text-sm">{{ t('canvases.search.noResults') }}</p>
    </div>
  </div>
</template>
