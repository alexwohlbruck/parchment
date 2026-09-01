<script setup lang="ts">
/**
 * A folder in the canvas stack, holding layers and marks together.
 *
 * It draws nothing itself — its switch is a shortcut for everything inside,
 * and its contents are the same rows they would be at the top level, so a
 * group is a way of tidying the stack rather than a different kind of thing
 * in it. Dragging works into and out of it because the list inside shares a
 * `group` name with the stack outside.
 */
import { ref, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import draggable from 'vuedraggable'
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
  GripVerticalIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
} from 'lucide-vue-next'
import type { CanvasGroup } from '@/types/canvas.types'
import type { StackChange, StackItem } from '@/lib/canvas-stack'

const props = defineProps<{
  group: CanvasGroup
  children: StackItem[]
  readonly?: boolean
}>()

const emit = defineEmits<{
  toggle: [visible: boolean]
  collapse: [collapsed: boolean]
  rename: [name: string]
  remove: []
  /** Sortable's own report of what landed here. */
  change: [change: StackChange]
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
    :class="!group.visible && 'opacity-60'"
  >
    <div class="flex items-center gap-2 px-2 py-1.5">
      <GripVerticalIcon
        v-if="!readonly"
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
        <FolderIcon class="size-3.5 shrink-0 text-muted-foreground" />
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
        v-if="!readonly"
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

      <DropdownMenu v-if="!readonly">
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

    <!-- An empty group has to be a target you can actually hit, so the list
         itself holds the height and the invitation sits behind it rather than
         below it — the whole panel takes a drop, not a 24px strip of it. -->
    <div v-if="!collapsed()" class="relative border-t px-2 py-1.5 pl-5">
      <p
        v-if="!children.length"
        class="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground pointer-events-none"
      >
        {{ t('canvases.groups.empty') }}
      </p>

      <draggable
        :model-value="children"
        item-key="id"
        handle=".canvas-stack-handle"
        :group="{ name: 'canvas-stack' }"
        :animation="150"
        :disabled="readonly"
        class="space-y-1.5"
        :class="!children.length && 'min-h-12'"
        @change="change => emit('change', change)"
      >
        <template #item="{ element }">
          <div>
            <slot name="item" :entry="element" />
          </div>
        </template>
      </draggable>
    </div>
  </div>
</template>
