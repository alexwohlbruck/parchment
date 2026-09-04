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
import { useRouter } from 'vue-router'
import {
  FolderIcon,
  Layers3Icon,
  LayersIcon,
  PlusIcon,
  StoreIcon,
} from 'lucide-vue-next'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { AppRoute } from '@/router'
import { useAppService } from '@/services/app.service'
import { useLayersStore } from '@/stores/layers.store'
import Layers from '@/components/map/Layers.vue'
import LayerStoreDialog from '@/components/map/layers/LayerStoreDialog.vue'
import LayerGroupConfiguration from '@/components/map/layers/LayerGroupConfiguration.vue'

const { t } = useI18n()
const router = useRouter()
const appService = useAppService()
const layersStore = useLayersStore()
const { mainReorderableItems } = storeToRefs(layersStore)

// The layer editor is a sheet view, not a dialog: it renders the draft on
// the live map while you edit, which a modal over the map cannot do.
function newLayer() {
  router.push({ name: AppRoute.LAYER_EDITOR_NEW })
}

function newGroup() {
  appService.componentDialog({
    component: LayerGroupConfiguration,
    continueText: t('general.save'),
  })
}

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
  </div>

  <div v-else class="h-full flex flex-col gap-2">
    <div class="flex items-center justify-end gap-2">
      <Button
        variant="outline"
        size="icon"
        class="h-10 w-10"
        :aria-label="t('layers.store.title')"
        :title="t('layers.store.title')"
        @click="storeOpen = true"
      >
        <StoreIcon class="h-4 w-4" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="outline" size="icon" class="h-10 w-10">
            <PlusIcon class="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem @click="newLayer">
            <LayersIcon class="size-4" />
            {{ t('layers.actions.newLayer') }}
          </DropdownMenuItem>
          <DropdownMenuItem @click="newGroup">
            <FolderIcon class="size-4" />
            {{ t('layers.actions.newGroup') }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <Layers class="flex-1 min-h-0" />
  </div>

  <LayerStoreDialog v-model:open="storeOpen" />
</template>
