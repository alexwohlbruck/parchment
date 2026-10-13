<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import {
  MoreHorizontalIcon,
  PlusIcon,
  FolderInputIcon,
  PencilIcon,
  Trash2Icon,
} from 'lucide-vue-next'
import { GroupRow } from '@/components/ui/group-row'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useCollectionGroupsStore } from '@/stores/library/collection-groups.store'
import { useCollectionGroupsService } from '@/services/library/collection-groups.service'
import {
  createCollectionGroup,
  moveCollectionGroup,
  deleteCollectionGroup,
  createCollectionInGroup,
} from './collection-group-dialog'
import type { CollectionGroup } from '@/types/collection-groups.types'

const props = defineProps<{
  group: CollectionGroup
  expanded: boolean
  count: number
}>()
const emit = defineEmits<{ 'update:expanded': [expanded: boolean] }>()
const { t } = useI18n()
const store = useCollectionGroupsStore()
const collectionGroupsService = useCollectionGroupsService()
</script>

<template>
  <GroupRow
    :name="group.name"
    :expanded="expanded"
    :count="count"
    :renameable="store.editable"
    :name-max-length="100"
    @rename="collectionGroupsService.updateGroup(group.id, { name: $event })"
    @update:expanded="emit('update:expanded', $event)"
  >
    <template #actions="{ startRename, onMenuClose }">
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            size="icon"
            class="size-7"
            :aria-label="
              t('library.collections.groups.actions', { name: group.name })
            "
            ><MoreHorizontalIcon class="size-3.5"
          /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" @close-auto-focus="onMenuClose">
          <DropdownMenuItem
            :disabled="!store.editable"
            @click="createCollectionInGroup(group.id)"
            ><PlusIcon class="size-3.5" />{{
              t('library.actions.newCollection')
            }}</DropdownMenuItem
          >
          <DropdownMenuItem
            :disabled="!store.editable"
            @click="createCollectionGroup(group.id)"
            ><PlusIcon class="size-3.5" />{{
              t('library.collections.groups.createNested')
            }}</DropdownMenuItem
          >
          <DropdownMenuItem :disabled="!store.editable" @click="startRename"
            ><PencilIcon class="size-3.5" />{{
              t('general.rename')
            }}</DropdownMenuItem
          >
          <DropdownMenuItem
            :disabled="!store.editable"
            @click="moveCollectionGroup(group.id)"
            ><FolderInputIcon class="size-3.5" />{{
              t('library.collections.groups.moveGroup')
            }}</DropdownMenuItem
          >
          <DropdownMenuItem
            :disabled="!store.editable"
            class="text-destructive"
            @click="deleteCollectionGroup(group.id)"
            ><Trash2Icon class="size-3.5" />{{
              t('library.collections.groups.remove')
            }}</DropdownMenuItem
          >
        </DropdownMenuContent>
      </DropdownMenu>
    </template>
    <slot />
  </GroupRow>
</template>
