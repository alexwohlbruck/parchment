<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'

import { FolderIcon } from 'lucide-vue-next'
import EmptyState from '@/components/library/EmptyState.vue'
import { useCollectionsService } from '@/services/library/collections.service'
import { useCollectionsStore } from '@/stores/library/collections.store'
import { storeToRefs } from 'pinia'
import CollectionsList from '@/components/library/CollectionsList.vue'
import Layers from '@/components/map/Layers.vue'
import SettingsSection from '@/components/settings/SettingsSection.vue'
import { Button } from '@/components/ui/button'
import { PlusIcon } from 'lucide-vue-next'
import { useAppService } from '@/services/app.service'
import { useI18n } from 'vue-i18n'
import LayerConfiguration from '@/components/map/layers/LayerConfiguration.vue'
import { type Layer } from '@/types/map.types'

const collectionsService = useCollectionsService()
const collectionsStore = useCollectionsStore()
const { collections } = storeToRefs(collectionsStore)
const loadingCollections = ref(true)
const appService = useAppService()
const { t } = useI18n()

onMounted(async () => {
  loadingCollections.value = true
  await collectionsService.fetchCollections()
  loadingCollections.value = false
})

const showEmptyState = computed(() => {
  return !loadingCollections.value && collections.value.length === 0
})

const loading = computed(() => {
  return loadingCollections.value && collections.value.length === 0
})

function openLayerConfigDialog(layerId?: Layer['configuration']['id']) {
  appService.componentDialog({
    component: LayerConfiguration,
    continueText: t('general.save'),
    props: {
      layerId,
    },
  })
}
</script>

<template>
  <div class="h-full flex flex-col">
    <EmptyState
      v-if="showEmptyState"
      :icon="FolderIcon"
      entity-id="collections"
      class="flex-1"
    />

    <SettingsSection
      :title="$t('settings.mapSettings.layers.title')"
      :frame="false"
    >
      <template v-slot:actions>
        <Button variant="outline" @click="openLayerConfigDialog">
          <PlusIcon class="size-4 mr-2" />
          {{ $t('settings.mapSettings.layers.new') }}
        </Button>
      </template>

      <Layers
        class="bg-background rounded-md overflow-hidden border border-border"
      />
    </SettingsSection>
  </div>
</template>
