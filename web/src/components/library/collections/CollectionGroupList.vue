<script setup lang="ts">
import { computed, shallowRef, inject, provide } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  buildGroupHierarchy,
  groupItemCounts,
  type GroupNode,
} from '@/lib/group-tree'
import CollectionCard from './CollectionCard.vue'
import CollectionGroupRow from './CollectionGroupRow.vue'
import { collectionGroupContextKey } from './collection-group-context'
import { useCollectionGroupsStore } from '@/stores/library/collection-groups.store'
import type { Collection } from '@/types/library.types'
import type { CollectionGroup } from '@/types/collection-groups.types'

const props = withDefaults(
  defineProps<{
    collections: Collection[]
    groups: CollectionGroup[]
    parentId?: string | null
    searching?: boolean
    nodes?: GroupNode<CollectionGroup>[]
  }>(),
  { parentId: null },
)
const { t } = useI18n()
const store = useCollectionGroupsStore()
const children = computed(
  () =>
    props.nodes ??
    buildGroupHierarchy(
      [...props.groups].sort((a, b) => a.name.localeCompare(b.name)),
      group => group.parentId,
    ),
)
const directCollections = computed(() =>
  props.collections.filter(
    collection =>
      (store.collectionGroupIds.get(collection.id) ?? null) === props.parentId,
  ),
)
const context = inject(collectionGroupContextKey, null) ?? {
  collapsed: shallowRef(new Set<string>()),
  counts: computed(() => {
    const direct = new Map<string, number>()
    for (const collection of props.collections) {
      const groupId = store.collectionGroupIds.get(collection.id)
      if (groupId) direct.set(groupId, (direct.get(groupId) ?? 0) + 1)
    }
    return groupItemCounts(
      new Map(props.groups.map(group => [group.id, group.parentId])),
      direct,
    )
  }),
}
provide(collectionGroupContextKey, context)
const { collapsed, counts } = context

function setExpanded(id: string, expanded: boolean) {
  const next = new Set(collapsed.value)
  if (expanded) next.delete(id)
  else next.add(id)
  collapsed.value = next
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <CollectionGroupRow
      v-for="node in children"
      :key="node.value.id"
      :group="node.value"
      :expanded="searching || !collapsed.has(node.value.id)"
      :count="counts.get(node.value.id) ?? 0"
      @update:expanded="setExpanded(node.value.id, $event)"
    >
      <CollectionGroupList
        :collections="collections"
        :groups="groups"
        :nodes="node.children"
        :parent-id="node.value.id"
        :searching="searching"
      />
    </CollectionGroupRow>
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
