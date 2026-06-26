<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AppRoute } from '@/router'
import PanelLayout from '@/components/layouts/PanelLayout.vue'
import { useAuthService } from '@/services/auth.service'
import { PermissionId } from '@/types/auth.types'
import UpgradeBanner from '@/components/subscription/UpgradeBanner.vue'
import { useCollectionsStore } from '@/stores/library/collections.store'
import { useLayersStore } from '@/stores/layers.store'
import { useRoutesStore } from '@/stores/library/routes.store'

const authService = useAuthService()
const canAccessLibrary = computed(() => authService.hasPermission(PermissionId.LIBRARY_READ))

const collectionsStore = useCollectionsStore()
const layersStore = useLayersStore()
const routesStore = useRoutesStore()
const { collections } = storeToRefs(collectionsStore)
const { userLayers } = storeToRefs(layersStore)
const { routes } = storeToRefs(routesStore)

const tabs = [
  { id: 'collections', label: 'Collections', route: AppRoute.LIBRARY_COLLECTIONS },
  { id: 'routes', label: 'Routes', route: AppRoute.LIBRARY_ROUTES },
  { id: 'layers', label: 'Layers', route: AppRoute.LIBRARY_LAYERS },
  { id: 'maps', label: 'Maps', route: AppRoute.LIBRARY_MAPS },
]

const tabCounts = computed<Record<string, number | null>>(() => ({
  collections: collections.value.length || null,
  layers: userLayers.value.length || null,
  routes: routes.value.length || null,
  maps: null,
}))

const router = useRouter()
const route = useRoute()

const tabValue = ref('collections')

function getTabIdFromRouteName(routeName: any) {
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

function handleTabChange(tabId: string | number) {
  const tab = tabs.find(t => t.id === String(tabId))
  if (tab) {
    router.push({ name: tab.route })
  }
}
</script>

<template>
  <PanelLayout>
    <template v-if="canAccessLibrary">
      <h1 class="text-2xl font-semibold mb-3">Library</h1>
      <Tabs
        :model-value="tabValue"
        @update:model-value="handleTabChange"
        class="w-full h-full flex flex-col"
      >
        <div class="-mx-3 px-3 flex items-end border-b relative" style="width: calc(100% + 1.5rem)">
          <TabsList variant="linear" class="border-b-0">
            <TabsTrigger
              v-for="tab in tabs"
              :key="tab.id"
              :value="tab.id"
              variant="linear"
              :count="tabCounts[tab.id]"
            >
              {{ tab.label }}
            </TabsTrigger>
          </TabsList>
          <div id="library-tab-actions" class="absolute right-3 bottom-1 flex items-center gap-0.5" />
        </div>

        <div class="flex-1 pt-3">
          <router-view />
        </div>
      </Tabs>
    </template>
    <UpgradeBanner v-else feature="library" required-tier="basic" />
  </PanelLayout>
</template>
