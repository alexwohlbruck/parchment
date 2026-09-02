<script setup lang="ts">
/**
 * The Layers tab.
 *
 * The list is never really empty — Parchment's own layers are projected into
 * it whether or not the user has made any — so the empty state is reserved
 * for the case where they have removed every last one, and points at the
 * store rather than at "create", since that's where they come back from.
 */
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { Layers3Icon, StoreIcon } from 'lucide-vue-next'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useLayersStore } from '@/stores/layers.store'
import Layers from '@/components/map/Layers.vue'
import LayerStoreDialog from '@/components/map/layers/LayerStoreDialog.vue'

const { t } = useI18n()
const layersStore = useLayersStore()
const { mainReorderableItems } = storeToRefs(layersStore)

const loading = ref(mainReorderableItems.value.length === 0)
const storeOpen = ref(false)

onMounted(async () => {
  await layersStore.loadLayers()
  loading.value = false
})

const isEmpty = computed(
  () => !loading.value && mainReorderableItems.value.length === 0,
)
</script>

<template>
  <div v-if="loading" class="flex-1 flex items-center justify-center py-12">
    <Spinner />
  </div>

  <div v-else-if="isEmpty" class="h-full flex items-start justify-center p-4">
    <EmptyState
      :icon="Layers3Icon"
      :title="t('layers.empty.title')"
      :description="t('layers.empty.description')"
      class="mt-20"
    >
      <Button size="sm" variant="outline" class="gap-1.5" @click="storeOpen = true">
        <StoreIcon class="size-3" />
        {{ t('layers.store.title') }}
      </Button>
    </EmptyState>
    <LayerStoreDialog v-model:open="storeOpen" />
  </div>

  <Layers v-else />
</template>
