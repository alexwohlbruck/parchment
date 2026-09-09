<script setup lang="ts">
/**
 * A folder in the canvas stack, holding layers, marks and other folders.
 *
 * It draws nothing itself — its switch is a shortcut for everything inside,
 * and its contents are the same rows they would be at the top level, so a
 * group is a way of tidying the stack rather than a different kind of thing
 * in it. The contents come in as a slot, which is what lets a group hold
 * another group without this component knowing how the stack is rendered.
 *
 * Selecting a group is how you say where you are working: while it — or
 * anything inside it — is the selected row, everything you draw and add is
 * filed here rather than at the top of the stack.
 */
import { useI18n } from 'vue-i18n'
import { useInlineRename } from '@/composables/useInlineRename'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  ChevronRightIcon,
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

const {
  renaming,
  draft,
  input: renameField,
  start: startRename,
  commit: commitRename,
  cancel: cancelRename,
  onMenuClose,
} = useInlineRename({
  value: () => props.group.name,
  onCommit: name => emit('rename', name),
})

const collapsed = () => props.group.collapsed === true
</script>

<template>
  <div
    class="rounded-lg border bg-card overflow-hidden"
    :class="[
      !group.visible && 'opacity-60',
      // Selected reads as selected; the open folder is the quieter signal
      // that this is where the next mark lands.
      selected && 'ring-1 ring-primary/40 border-primary/40',
    ]"
  >
    <div class="flex items-center gap-2 px-2 py-1.5">
      <GripVerticalIcon
        class="size-3.5 shrink-0 text-muted-foreground/60 cursor-grab canvas-stack-handle"
      />

      <!-- Folding a group and pointing at it are different intentions, so
           the chevron is its own control rather than the whole row. -->
      <button
        class="shrink-0 text-muted-foreground"
        :aria-expanded="!collapsed()"
        :aria-label="t(collapsed() ? 'general.expand' : 'general.collapse')"
        @click.stop="emit('collapse', !collapsed())"
      >
        <ChevronRightIcon
          class="size-3 transition-transform duration-150"
          :class="!collapsed() && 'rotate-90'"
        />
      </button>

      <button
        class="flex items-center gap-2 min-w-0 flex-1 text-left"
        :aria-pressed="selected"
        :title="destination ? t('canvases.groups.drawingHere') : undefined"
        @click="emit('select')"
      >
        <component
          :is="destination ? FolderOpenIcon : FolderIcon"
          class="size-3.5 shrink-0"
          :class="destination ? 'text-primary' : 'text-muted-foreground'"
        />
        <Input
          v-if="renaming"
          ref="renameField"
          v-model="draft"
          class="h-6 text-sm"
          @click.stop
          @blur="commitRename"
          @keydown.enter="commitRename"
          @keydown.esc="cancelRename"
        />
        <!-- The name is the way in to renaming it; the rest of the row is
             how you point the panel at the group. -->
        <span
          v-else
          class="text-sm truncate cursor-text hover:underline decoration-dotted underline-offset-2"
          :title="t('canvases.groups.rename')"
          @click.stop="startRename"
        >
          {{ group.name }}
        </span>
      </button>

      <Button
        variant="ghost"
        size="icon"
        class="size-7 shrink-0"
        :title="t(group.visible ? 'canvases.layers.hide' : 'canvases.layers.show')"
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
          <Button variant="ghost" size="icon" class="size-7 shrink-0">
            <MoreHorizontalIcon class="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" @close-auto-focus="onMenuClose">
          <DropdownMenuItem @click="startRename">
            <PencilIcon class="size-3.5" />
            {{ t('canvases.groups.rename') }}
          </DropdownMenuItem>
          <!-- Ungrouping keeps what was inside; with nothing inside, that
               is just a delete, and saying "Ungroup" would be a riddle. -->
          <DropdownMenuItem class="text-destructive" @click="emit('remove')">
            <Trash2Icon class="size-3.5" />
            {{ t(empty ? 'canvases.groups.delete' : 'canvases.groups.remove') }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <div v-if="!collapsed()" class="border-t px-2 py-1.5 pl-5">
      <slot />
    </div>
  </div>
</template>
