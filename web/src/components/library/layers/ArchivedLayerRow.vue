<script setup lang="ts">
import { computed, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import * as LucideIcons from 'lucide-vue-next'
import {
  ArchiveRestoreIcon,
  FolderIcon,
  LayersIcon,
  MoreHorizontalIcon,
  TrashIcon,
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useLayerDelete } from '@/composables/library/useLayerDelete'
import { useArchiveService } from '@/services/library/archive.service'
import type { Layer, LayerGroup } from '@/types/map.types'

const props = defineProps<{ item: Layer | LayerGroup }>()

const { t } = useI18n()
const { deleteLayer, deleteGroup } = useLayerDelete()
const archiveService = useArchiveService()

const isGroup = computed(() => !('groupId' in props.item))

const icon = computed<Component>(() => {
  const name = props.item.icon
  const own = name && LucideIcons[`${name.replace(/Icon$/, '')}Icon` as keyof typeof LucideIcons]
  if (typeof own === 'function') return own as Component
  return isGroup.value ? FolderIcon : LayersIcon
})

function remove() {
  return isGroup.value ? deleteGroup(props.item) : deleteLayer(props.item)
}
</script>

<template>
  <div class="flex items-center gap-2 p-2 border rounded-lg bg-background">
    <component :is="icon" class="size-4 shrink-0 text-muted-foreground" />
    <span class="flex-1 min-w-0 truncate text-sm font-medium">{{ item.name }}</span>
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button variant="ghost" size="icon" class="h-6 w-6 p-0">
          <MoreHorizontalIcon class="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem @click="archiveService.setLayerArchived(item, false)">
          <ArchiveRestoreIcon class="size-3 mr-2" />
          {{ t('general.unarchive') }}
        </DropdownMenuItem>
        <DropdownMenuItem class="text-destructive" @click="remove">
          <TrashIcon class="size-3 mr-2" />
          {{ t(isGroup ? 'layers.actions.deleteGroup' : 'layers.actions.deleteLayer') }}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>
