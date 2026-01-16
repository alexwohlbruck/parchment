<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AppRoute } from '@/router'
import {
  FolderOpenIcon,
  RouteIcon,
  MapIcon,
  Layers3Icon,
} from 'lucide-vue-next'
import PanelLayout from '@/components/layouts/PanelLayout.vue'

const tabs = [
  {
    id: 'collections',
    route: AppRoute.LIBRARY_COLLECTIONS,
    icon: FolderOpenIcon,
  },
  { id: 'routes', route: AppRoute.LIBRARY_ROUTES, icon: RouteIcon },
  { id: 'layers', route: AppRoute.LIBRARY_LAYERS, icon: Layers3Icon },
  { id: 'maps', route: AppRoute.LIBRARY_MAPS, icon: MapIcon },
]

const router = useRouter()
const route = useRoute()

const tabValue = ref('collections')

function getTabIdFromRouteName(routeName) {
  const tab = tabs.find(tab => tab.route === routeName)
  return tab ? tab.id : 'collections'
}

watch(
  () => route.name,
  newRouteName => {
    if (newRouteName) {
      tabValue.value = getTabIdFromRouteName(newRouteName)
    }
  },
  { immediate: true },
)

function handleTabChange(tabId) {
  const tab = tabs.find(t => t.id === tabId)
  if (tab) {
    router.push({ name: tab.route })
  }
}
</script>

<template>
  <PanelLayout>
    <Tabs
      :model-value="tabValue"
      @update:model-value="handleTabChange"
      class="w-full h-full flex flex-col gap-2"
    >
      <TabsList class="w-full flex">
        <TabsTrigger
          v-for="tab in tabs"
          :key="tab.id"
          :value="tab.id"
          class="flex-1 gap-2"
        >
          <component :is="tab.icon" class="size-5" />
        </TabsTrigger>
      </TabsList>

      <!-- TODO: Create dedicated header, scrollably body, and footer in bottom sheet component -->
      <div class="flex-1">
        <router-view />
      </div>
    </Tabs>
  </PanelLayout>
</template>
