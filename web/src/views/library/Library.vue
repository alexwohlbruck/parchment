<script setup lang="ts">
import { ref } from 'vue'
import { useAuthStore } from '@/stores/auth.store'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import {
  MapPinIcon,
  FolderOpenIcon,
  RouteIcon,
  MapIcon,
  Layers3Icon,
  PlusIcon,
} from 'lucide-vue-next'
import { useResponsive } from '@/lib/utils'
import { useI18n } from 'vue-i18n'
import EmptyState from '@/components/library/EmptyState.vue'
import Layers from '@/components/map/Layers.vue'
import { storeToRefs } from 'pinia'
import { useMapStore } from '@/stores/map.store'
import { useAppService } from '@/services/app.service'
import LayerConfiguration from '@/components/map/layers/LayerConfiguration.vue'

const collections = [
  { id: 'places', icon: MapPinIcon },
  { id: 'collections', icon: FolderOpenIcon },
  { id: 'routes', icon: RouteIcon },
  { id: 'layers', icon: Layers3Icon },
  { id: 'maps', icon: MapIcon },
]

const activeCollection = ref('places')
const { isXSmallScreen } = useResponsive()
const mapStore = useMapStore()
const { layers } = storeToRefs(mapStore)
const appService = useAppService()
const { t } = useI18n()

function openLayerConfigDialog() {
  appService.componentDialog({
    component: LayerConfiguration,
    continueText: t('general.save'),
  })
}
</script>

<template>
  <div class="p-4 h-full w-full flex flex-col">
    <Tabs v-model="activeCollection" class="w-full h-full flex flex-col">
      <TabsList class="w-full flex">
        <TabsTrigger
          v-for="collection in collections"
          :key="collection.id"
          :value="collection.id"
          class="flex-1 gap-2"
        >
          <component :is="collection.icon" class="size-5" />
        </TabsTrigger>
      </TabsList>

      <TabsContent
        v-for="collection in collections"
        :key="collection.id"
        :value="collection.id"
        class="flex-1"
      >
        <template v-if="collection.id === 'layers'">
          <div class="flex flex-col gap-4">
            <div class="flex justify-end">
              <Button variant="outline" @click="openLayerConfigDialog">
                <PlusIcon class="size-4 mr-2" />
                {{ t('settings.mapSettings.layers.new') }}
              </Button>
            </div>
            <Layers v-if="layers.length > 0" />
            <EmptyState
              v-else
              :icon="collection.icon"
              :collection-id="collection.id"
            />
          </div>
        </template>
        <EmptyState
          v-else
          :icon="collection.icon"
          :collection-id="collection.id"
        />
      </TabsContent>
    </Tabs>
  </div>
</template>
