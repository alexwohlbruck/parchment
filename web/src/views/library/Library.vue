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
} from 'lucide-vue-next'
import { useResponsive } from '@/lib/utils'

const collections = [
  { id: 'places', label: 'Places', singular: 'place', icon: MapPinIcon },
  {
    id: 'collections',
    label: 'Collections',
    singular: 'collection',
    icon: FolderOpenIcon,
  },
  { id: 'routes', label: 'Routes', singular: 'route', icon: RouteIcon },
  { id: 'maps', label: 'Maps', singular: 'map', icon: MapIcon },
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
          <component
            :is="collection.icon"
            :class="['w-4 h-4', { 'w-5 h-5': isXSmallScreen }]"
          />
          <span v-if="!isXSmallScreen">{{ collection.label }}</span>
        </TabsTrigger>
      </TabsList>

      <TabsContent
        v-for="collection in collections"
        :key="collection.id"
        :value="collection.id"
        class="flex-1 mt-32"
      >
        <div class="flex flex-col items-center gap-3">
          <component
            :is="collection.icon"
            class="h-12 w-12 text-muted-foreground"
          />
          <p class="text-muted-foreground text-sm">
            No {{ collection.label.toLowerCase() }} yet
          </p>
          <Button disabled variant="outline" size="sm" class="gap-1.5">
            <PlusIcon class="h-3 w-3" />
            Create {{ collection.singular }}
          </Button>
        </div>
      </TabsContent>
    </Tabs>
  </div>
</template>
