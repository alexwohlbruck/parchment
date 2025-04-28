<script setup lang="ts">
import { computed } from 'vue'
import { Card, CardContent } from '@/components/ui/card'
import { useI18n } from 'vue-i18n'
import { StarIcon } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import type { Collection } from '@/types/library.types'
import { getThemeColorClasses, type ThemeColor } from '@/lib/utils'
import { ItemIcon } from '@/components/ui/item-icon'
import CollectionContextMenu from '@/components/library/CollectionContextMenu.vue'

const props = defineProps<{
  collection: Collection
}>()

const router = useRouter()
const { t } = useI18n()

const colorClasses = computed(() => {
  return getThemeColorClasses(props.collection.iconColor as ThemeColor)
})

const collectionName = computed(() => {
  // If this is the default collection, use the i18n name
  if (props.collection.isDefault) {
    // If the collection has a custom name, use it, otherwise use the i18n name
    return props.collection.name || t('library.entities.collections.default')
  }

  return props.collection.name
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
          class="absolute -top-1 -right-1 bg-yellow-500 text-yellow-800 rounded-full p-[.15rem]"
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
              <h3 class="font-semibold text-sm">{{ collectionName }}</h3>
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
