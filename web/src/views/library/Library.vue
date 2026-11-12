<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AppRoute } from '@/router'
import PanelLayout from '@/components/sheet/layouts/PanelLayout.vue'
import { useAuthService } from '@/services/auth.service'
import { PermissionId } from '@/types/auth.types'
import UpgradeBanner from '@/components/subscription/UpgradeBanner.vue'
import { useCollectionsStore } from '@/stores/library/collections.store'
import { useLayersStore } from '@/stores/layers.store'
import { useRoutesStore } from '@/stores/library/routes.store'
import { useCanvasesStore } from '@/stores/library/canvases.store'
import { useI18n } from 'vue-i18n'
import { ArchiveIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { CountBadge } from '@/components/ui/count-badge'
import { useArchivedItems, type ArchiveKind } from '@/composables/library/useArchivedItems'

const authService = useAuthService()
const canAccessLibrary = computed(() => authService.hasPermission(PermissionId.LIBRARY_READ))

const collectionsStore = useCollectionsStore()
const layersStore = useLayersStore()
const routesStore = useRoutesStore()
const canvasesStore = useCanvasesStore()
const { collections } = storeToRefs(collectionsStore)
const { userLayers } = storeToRefs(layersStore)
const { routes } = storeToRefs(routesStore)
const { canvases } = storeToRefs(canvasesStore)

const tabs = [
  { id: 'collections', label: 'Collections', route: AppRoute.LIBRARY_COLLECTIONS },
  { id: 'routes', label: 'Routes', route: AppRoute.LIBRARY_ROUTES },
  { id: 'layers', label: 'Layers', route: AppRoute.LIBRARY_LAYERS },
  { id: 'canvases', label: 'Canvases', route: AppRoute.LIBRARY_CANVASES },
]

const unarchived = (items: { archivedAt?: string | null }[]) =>
  items.filter(item => !item.archivedAt).length || null

const tabCounts = computed<Record<string, number | null>>(() => ({
  collections: unarchived(collections.value),
  layers: userLayers.value.length || null,
  routes: unarchived(routes.value),
  canvases: unarchived(canvases.value),
}))

const router = useRouter()
const { t } = useI18n()
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

const archived = useArchivedItems()
const archivedCount = computed(() => archived.counts.value[tabValue.value as ArchiveKind] ?? 0)

function openArchive() {
  router.push({ name: AppRoute.LIBRARY_ARCHIVE, params: { kind: tabValue.value } })
}

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
        class="w-full min-h-full flex flex-col"
      >
        <div class="-mx-3 px-3 flex items-end border-b" style="width: calc(100% + 1.5rem)">
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
        </div>

        <div class="flex-1 pt-3">
          <router-view />
        </div>

        <div
          v-if="archivedCount"
          class="sticky bottom-0 -mx-3 -mb-4 px-3 py-3 bg-background/80 backdrop-blur-xl border-t border-border/50"
        >
          <Button variant="ghost" class="w-full justify-start gap-2 text-muted-foreground" @click="openArchive">
            <ArchiveIcon class="size-4" />
            {{ t('library.archived') }}
            <CountBadge :count="archivedCount" />
          </Button>
        </div>
      </Tabs>
    </template>
    <UpgradeBanner v-else feature="library" required-tier="basic" />
  </PanelLayout>
</template>
