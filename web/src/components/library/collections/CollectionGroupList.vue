<script setup lang="ts">
import { computed, markRaw, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ChevronRightIcon,
  FolderIcon,
  FolderOpenIcon,
  MoreHorizontalIcon,
  PlusIcon,
  PencilIcon,
  Trash2Icon,
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import ResponsiveDropdown, {
  type MenuItemDefinition,
} from '@/components/responsive/ResponsiveDropdown.vue'
import CollectionCard from './CollectionCard.vue'
import {
  editCollectionGroup,
  deleteCollectionGroup,
  createCollectionInGroup,
} from './collection-group-dialog'
import { useCollectionGroupsStore } from '@/stores/library/collection-groups.store'
import type { Collection } from '@/types/library.types'
import type { CollectionGroup } from '@/types/collection-groups.types'

const props = withDefaults(
  defineProps<{
    collections: Collection[]
    groups: CollectionGroup[]
    parentId?: string | null
    searching?: boolean
  }>(),
  { parentId: null },
)
const { t } = useI18n()
const store = useCollectionGroupsStore()
const collapsed = ref(new Set<string>())
const children = computed(() =>
  props.groups
    .filter(group => group.parentId === props.parentId)
    .sort((a, b) => a.name.localeCompare(b.name)),
)
const directCollections = computed(() =>
  props.collections.filter(collection => {
    const groupId = store.collectionGroupIds.get(collection.id) ?? null
    return groupId === props.parentId
  }),
)

function toggle(id: string) {
  const next = new Set(collapsed.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  collapsed.value = next
}

function menuItems(group: CollectionGroup): MenuItemDefinition[] {
  const disabled = !store.editable
  return [
    {
      type: 'item',
      label: t('library.actions.newCollection'),
      icon: markRaw(PlusIcon),
      disabled,
      onSelect: () => createCollectionInGroup(group.id),
    },
    {
      type: 'item',
      label: t('library.collections.groups.createNested'),
      icon: markRaw(PlusIcon),
      disabled,
      onSelect: () => editCollectionGroup(undefined, group.id),
    },
    {
      type: 'item',
      label: t('library.collections.groups.edit'),
      icon: markRaw(PencilIcon),
      disabled,
      onSelect: () => editCollectionGroup(group.id),
    },
    {
      type: 'item',
      label: t('library.collections.groups.remove'),
      icon: markRaw(Trash2Icon),
      disabled,
      variant: 'destructive',
      onSelect: () => deleteCollectionGroup(group.id),
    },
  ]
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div
      v-for="group in children"
      :key="group.id"
      role="group"
      :aria-label="group.name"
      class="rounded-lg border bg-card"
    >
      <div class="flex items-center gap-2 px-2 py-1.5">
        <button
          class="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 text-left text-sm hover:bg-muted"
          :aria-expanded="searching || !collapsed.has(group.id)"
          @click="toggle(group.id)"
        >
          <ChevronRightIcon
            class="size-3.5 shrink-0 transition-transform"
            :class="(searching || !collapsed.has(group.id)) && 'rotate-90'"
          />
          <component
            :is="
              searching || !collapsed.has(group.id)
                ? FolderOpenIcon
                : FolderIcon
            "
            class="size-4 shrink-0 text-muted-foreground"
          />
          <span class="truncate">{{ group.name }}</span>
        </button>
        <ResponsiveDropdown :items="menuItems(group)" align="end">
          <template #trigger="{ open }">
            <Button
              variant="ghost"
              size="icon"
              class="size-8"
              :aria-label="
                t('library.collections.groups.actions', { name: group.name })
              "
              @click="open"
            >
              <MoreHorizontalIcon class="size-4" />
            </Button>
          </template>
        </ResponsiveDropdown>
      </div>
      <div
        v-if="searching || !collapsed.has(group.id)"
        class="border-t p-2 pl-4"
      >
        <CollectionGroupList
          :collections="collections"
          :groups="groups"
          :parent-id="group.id"
          :searching="searching"
        />
      </div>
    </div>
    <CollectionCard
      v-for="collection in directCollections"
      :key="collection.id"
      :collection="collection"
      class="w-full"
    />
    <p
      v-if="parentId && !children.length && !directCollections.length"
      class="px-2 py-3 text-sm text-muted-foreground"
    >
      {{ t('library.collections.groups.empty') }}
    </p>
  </div>
</template>
