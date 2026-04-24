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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import CollectionContextMenu from '@/components/library/CollectionContextMenu.vue'
import { useCollectionsService } from '@/services/library/collections.service'
import { useFriendsStore } from '@/stores/friends.store'

const props = defineProps<{
  collection: Collection
}>()

const router = useRouter()
const collectionsService = useCollectionsService()
const friendsStore = useFriendsStore()
const { t } = useI18n()

const displayName = computed(() => {
  return collectionsService.getCollectionDisplayName(props.collection)
})

// When the collection is shared TO the caller, find the sender in the
// friends store so we can show their avatar as a badge on the icon —
// a Google-Docs-style "you see this because X shared it" cue.
const owner = computed(() => {
  if (!props.collection.senderHandle) return null
  const friend = friendsStore.friends.find(
    (f) => f.friendHandle === props.collection.senderHandle,
  )
  if (!friend) return null
  const name = friend.friendName || friend.friendHandle.split('@')[0]
  return {
    name,
    picture: friend.friendPicture ?? null,
    initials: name.slice(0, 2).toUpperCase(),
  }
})

const isShared = computed(
  () => !!props.collection.role && props.collection.role !== 'owner',
)

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
      <!-- Icon with overlays:
           - star for the user's default collection
           - owner avatar badge for collections shared TO the user -->
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
        <Avatar
          v-else-if="isShared && owner"
          class="absolute -bottom-1 -right-1 size-4 ring-2 ring-background"
          :title="t('library.entities.collections.sharedBy', { name: owner.name })"
        >
          <AvatarImage v-if="owner.picture" :src="owner.picture" />
          <AvatarFallback class="text-[8px]">{{ owner.initials }}</AvatarFallback>
        </Avatar>
      </div>

      <!-- Content -->
      <div class="grow min-w-0">
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
