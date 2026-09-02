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
 * A group can also be the destination: while it is, everything you draw and
 * everything you add is filed here rather than at the top of the stack.
 */
import { ref, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
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
  CrosshairIcon,
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
  /** True when new marks and layers are filed in this group. */
  active?: boolean
}>()

const emit = defineEmits<{
  toggle: [visible: boolean]
  collapse: [collapsed: boolean]
  rename: [name: string]
  /** Aim new work at this group, or hand it back to the canvas. */
  activate: [active: boolean]
  remove: []
}>()

const { t } = useI18n()

const renaming = ref(false)
const draft = ref(props.group.name)
const nameInput = ref<InstanceType<typeof Input> | null>(null)

watch(renaming, async open => {
  if (!open) return
  draft.value = props.group.name
  await nextTick()
  const el = (nameInput.value?.$el ?? nameInput.value) as
    | HTMLInputElement
    | undefined
  el?.focus?.()
  el?.select?.()
})

function commitName() {
  renaming.value = false
  const next = draft.value.trim()
  if (next && next !== props.group.name) emit('rename', next)
}

const collapsed = () => props.group.collapsed === true
</script>

<template>
  <div
    class="rounded-lg border bg-card overflow-hidden"
    :class="[
      !group.visible && 'opacity-60',
      // The destination reads at a glance, without having to hover the row
      // that says so — you are about to draw into it.
      active && 'ring-1 ring-primary/40 border-primary/40',
    ]"
  >
    <div class="flex items-center gap-2 px-2 py-1.5">
      <GripVerticalIcon
        class="size-3.5 shrink-0 text-muted-foreground/60 cursor-grab canvas-stack-handle"
      />

      <button
        class="flex items-center gap-2 min-w-0 flex-1 text-left"
        :aria-expanded="!collapsed()"
        @click="emit('collapse', !collapsed())"
      >
        <ChevronRightIcon
          class="size-3 shrink-0 text-muted-foreground transition-transform duration-150"
          :class="!collapsed() && 'rotate-90'"
        />
        <component
          :is="active ? FolderOpenIcon : FolderIcon"
          class="size-3.5 shrink-0"
          :class="active ? 'text-primary' : 'text-muted-foreground'"
        />
        <Input
          v-if="renaming"
          ref="nameInput"
          v-model="draft"
          class="h-6 text-sm"
          @click.stop
          @blur="commitName"
          @keydown.enter="commitName"
          @keydown.esc="renaming = false"
        />
        <span v-else class="text-sm truncate">{{ group.name }}</span>
      </button>

      <Button
        variant="ghost"
        size="icon"
        class="size-7 shrink-0"
        :class="active && 'text-primary bg-primary/10 hover:bg-primary/15'"
        :aria-pressed="active"
        :title="
          t(active ? 'canvases.groups.drawingHere' : 'canvases.groups.drawHere')
        "
        :aria-label="
          t(active ? 'canvases.groups.drawingHere' : 'canvases.groups.drawHere')
        "
        @click.stop="emit('activate', !active)"
      >
        <CrosshairIcon class="size-3.5" />
      </Button>

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
        <DropdownMenuContent align="end">
          <DropdownMenuItem @click="renaming = true">
            <PencilIcon class="size-3.5" />
            {{ t('canvases.groups.rename') }}
          </DropdownMenuItem>
          <DropdownMenuItem class="text-destructive" @click="emit('remove')">
            <Trash2Icon class="size-3.5" />
            {{ t('canvases.groups.remove') }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <div v-if="!collapsed()" class="border-t px-2 py-1.5 pl-5">
      <slot />
    </div>
  </div>
</template>
