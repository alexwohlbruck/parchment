<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ClockIcon } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import type { Collection } from '@/types/library.types'
import { type ThemeColor } from '@/lib/utils'
import { ItemIcon } from '@/components/ui/item-icon'
import { ItemRow } from '@/components/ui/item-row'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import CollectionContextMenu from '@/components/library/CollectionContextMenu.vue'
import { useCollectionsService } from '@/services/library/collections.service'
import { useCollectionsStore } from '@/stores/library/collections.store'
import { useFriendsStore } from '@/stores/friends.store'
import { storeToRefs } from 'pinia'

const props = defineProps<{
  collection: Collection
}>()

const router = useRouter()
const collectionsService = useCollectionsService()
const collectionsStore = useCollectionsStore()
const friendsStore = useFriendsStore()
const { lastSavedCollectionId } = storeToRefs(collectionsStore)
const { t } = useI18n()

const isLastSaved = computed(
  () => props.collection.id === lastSavedCollectionId.value,
)

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
  <ItemRow
    :title="displayName"
    size="md"
    interactive
    :has-details="!!collection.description"
    @click="goToCollection"
  >
    <!-- Icon with overlays:
         - clock for the collection the user most recently saved to on this
           device (the bookmark button's one-tap target)
         - owner avatar badge for collections shared TO the user -->
    <template #icon="{ size }">
      <div class="relative shrink-0">
        <ItemIcon
          :icon="collection.icon"
          :icon-pack="collection.iconPack ?? 'lucide'"
          :color="collection.iconColor as ThemeColor"
          :size="size"
        />
        <div
          v-if="isLastSaved"
          class="absolute -top-1 -right-1 bg-muted text-muted-foreground ring-2 ring-background rounded-full p-[.15rem]"
          :title="t('library.entities.collections.lastSaved')"
        >
          <ClockIcon class="size-2.5" stroke-width="3" />
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
    </template>

    <template #details="{ detailClass }">
      <div
        v-if="collection.description"
        class="text-muted-foreground line-clamp-2"
        :class="detailClass"
      >
        {{ collection.description }}
      </div>
    </template>

    <template #trailing>
      <CollectionContextMenu :collection="collection" />
    </template>
  </ItemRow>
</template>
