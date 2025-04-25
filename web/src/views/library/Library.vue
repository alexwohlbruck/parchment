<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AppRoute } from '@/router'
import {
  MapPinIcon,
  FolderOpenIcon,
  RouteIcon,
  MapIcon,
  Layers3Icon,
} from 'lucide-vue-next'

const tabs = [
  { id: 'places', route: AppRoute.LIBRARY_PLACES, icon: MapPinIcon },
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

const tabValue = ref('places')

function getTabIdFromRouteName(routeName) {
  const tab = tabs.find(tab => tab.route === routeName)
  return tab ? tab.id : 'places'
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
  <div class="p-4 h-full w-full flex flex-col">
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

      <div class="flex-1 overflow-auto">
        <router-view />
      </div>
    </Tabs>
  </div>
</template>
