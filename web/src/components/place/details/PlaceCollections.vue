<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import type { Place } from '@/types/place.types'
import { type ThemeColor } from '@/lib/utils'
import { ItemIcon } from '@/components/ui/item-icon'
import { SectionHeader } from '@/components/ui/section-header'
import { useCollectionsStore } from '@/stores/library/collections.store'
import { useCollectionsService } from '@/services/library/collections.service'

const props = defineProps<{
  place: Partial<Place>
}>()

const { t } = useI18n()
const router = useRouter()
const collectionsStore = useCollectionsStore()
const collectionsService = useCollectionsService()

const collections = computed(() =>
  (props.place.collectionIds ?? []).flatMap((id) => {
    const collection = collectionsStore.getCollectionById(id)
    return collection ? [collection] : []
  }),
)

function openCollection(id: string) {
  router.push({ name: AppRoute.COLLECTION, params: { id } })
}
</script>

<template>
  <div v-if="collections.length" class="flex flex-col gap-2">
    <SectionHeader :title="t('place.collections.savedIn')" />
    <div class="flex flex-wrap gap-1.5">
      <button
        v-for="collection in collections"
        :key="collection.id"
        class="inline-flex items-center gap-1 rounded-full border pl-0.5 pr-2 py-0.5 bg-background transition-colors hover:bg-muted"
        @click="openCollection(collection.id)"
      >
        <ItemIcon
          :icon="collection.icon"
          :icon-pack="collection.iconPack ?? 'lucide'"
          :color="collection.iconColor as ThemeColor"
          size="xs"
          shape="circle"
          variant="solid"
        />
        <span class="text-xs font-medium">
          {{ collectionsService.getCollectionDisplayName(collection) }}
        </span>
      </button>
    </div>
  </div>
</template>
