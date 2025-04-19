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
  PlusIcon,
  Layers3Icon,
} from 'lucide-vue-next'
import { useResponsive } from '@/lib/utils'
import { useI18n } from 'vue-i18n'
import { capitalize } from '@/filters/text.filters'
import EmptyState from '@/components/library/EmptyState.vue'

const { t } = useI18n()

const collections = [
  { id: 'places', icon: MapPinIcon },
  { id: 'collections', icon: FolderOpenIcon },
  { id: 'routes', icon: RouteIcon },
  { id: 'layers', icon: Layers3Icon },
  { id: 'maps', icon: MapIcon },
]

const activeCollection = ref('places')
const { isXSmallScreen } = useResponsive()
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
        class="flex-1 mt-32"
      >
        <EmptyState :icon="collection.icon" :collection-id="collection.id" />
      </TabsContent>
    </Tabs>
  </div>
</template>
