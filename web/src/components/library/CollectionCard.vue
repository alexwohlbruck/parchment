<script setup lang="ts">
import { computed } from 'vue'
import { Card, CardContent } from '@/components/ui/card'
import { useI18n } from 'vue-i18n'
import { StarIcon } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import type { Collection } from '@/types/library.types'
import { type ThemeColor } from '@/lib/utils'
import { ItemIcon } from '@/components/ui/item-icon'
import CollectionContextMenu from '@/components/library/CollectionContextMenu.vue'
import { useCollectionsService } from '@/services/library/collections.service'

const props = defineProps<{
  collection: Collection
}>()

const router = useRouter()
const collectionsService = useCollectionsService()

const displayName = computed(() => {
  return collectionsService.getCollectionDisplayName(props.collection)
})

function goToCollection() {
  router.push({
    name: AppRoute.COLLECTION,
    params: { id: props.collection.id },
  })
}
</script>

<template>
  <Card
    class="overflow-hidden hover:bg-secondary/40 transition-colors cursor-pointer"
    @click="goToCollection"
  >
    <CardContent class="p-2 flex items-center gap-3">
      <!-- Icon with star overlay for default collections -->
      <div class="relative">
        <ItemIcon
          :icon="collection.icon"
          :color="collection.iconColor as ThemeColor"
          size="md"
        />
        <div
          v-if="collection.isDefault"
          class="absolute -top-1 -right-1 bg-yellow-300 dark:bg-yellow-400 text-yellow-800 rounded-full p-[.15rem]"
          title="Default Collection"
        >
          <StarIcon class="size-2.5" stroke-width="3" />
        </div>
      </div>

      <!-- Content -->
      <div class="flex-grow min-w-0">
        <div class="flex items-center justify-between">
          <div class="flex flex-col justify-center">
            <div class="flex items-center gap-2">
              <h3 class="font-semibold text-sm">{{ displayName }}</h3>
            </div>

            <!-- Display collection description if available -->
            <div
              v-if="collection.description"
              class="text-xs text-muted-foreground line-clamp-2"
            >
              {{ collection.description }}
            </div>
          </div>

          <!-- Actions dropdown -->
          <CollectionContextMenu :collection="collection" />
        </div>
      </div>
    </CardContent>
  </Card>
</template>
