<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { GroupRow } from '@/components/ui/group-row'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  EyeIcon,
  EyeOffIcon,
  FolderIcon,
  FolderOpenIcon,
  GripVerticalIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
} from 'lucide-vue-next'
import type { CanvasGroup } from '@/types/canvas.types'

const props = defineProps<{
  group: CanvasGroup
  /** Nothing filed in it, so removing it takes nothing with it. */
  empty?: boolean
  /** The row the panel is pointed at. */
  selected?: boolean
  /**
   * True when new marks and layers are filed here — this group is selected,
   * or something inside it is.
   */
  destination?: boolean
}>()

const emit = defineEmits<{
  toggle: [visible: boolean]
  collapse: [collapsed: boolean]
  rename: [name: string]
  /** Point the panel at this group, or, if it already is, at the canvas. */
  select: []
  remove: []
}>()

const { t } = useI18n()

const collapsed = () => props.group.collapsed === true
</script>

<template>
  <GroupRow
    :name="group.name"
    :expanded="!collapsed()"
    :selected="selected"
    :muted="!group.visible"
    renameable
    selectable
    :label-title="destination ? t('canvases.groups.drawingHere') : undefined"
    @rename="emit('rename', $event)"
    @select="emit('select')"
    @update:expanded="emit('collapse', !$event)"
  >
    <template #leading>
      <GripVerticalIcon
        class="size-3.5 shrink-0 text-muted-foreground/60 cursor-grab canvas-stack-handle"
      />
    </template>
    <template #icon>
      <button type="button" :aria-label="group.name" @click="emit('select')">
        <component
          :is="!collapsed() ? FolderOpenIcon : FolderIcon"
          class="size-4 shrink-0"
          :class="destination ? 'text-primary' : 'text-muted-foreground'"
        />
      </button>
    </template>
    <template #actions="{ startRename, onMenuClose }">
      <Button
        variant="ghost"
        size="icon"
        class="size-7"
        :title="
          t(group.visible ? 'canvases.layers.hide' : 'canvases.layers.show')
        "
        :aria-label="
          t(group.visible ? 'canvases.layers.hide' : 'canvases.layers.show')
        "
        @click.stop="emit('toggle', !group.visible)"
      >
        <EyeIcon v-if="group.visible" class="size-3.5" />
        <EyeOffIcon v-else class="size-3.5 text-muted-foreground" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger as-child @click.stop>
          <Button
            variant="ghost"
            size="icon"
            class="size-7"
            :aria-label="t('general.more')"
          >
            <MoreHorizontalIcon class="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" @close-auto-focus="onMenuClose">
          <DropdownMenuItem @click="startRename">
            <PencilIcon class="size-3.5" />
            {{ t('general.rename') }}
          </DropdownMenuItem>
          <DropdownMenuItem class="text-destructive" @click="emit('remove')">
            <Trash2Icon class="size-3.5" />
            {{ t(empty ? 'canvases.groups.delete' : 'canvases.groups.remove') }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </template>
    <slot />
  </GroupRow>
</template>
