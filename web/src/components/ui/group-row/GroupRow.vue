<script setup lang="ts">
import { useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { FolderIcon, FolderOpenIcon } from 'lucide-vue-next'
import GroupDisclosure from './GroupDisclosure.vue'
import { useInlineRename } from '@/composables/useInlineRename'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

const props = defineProps<{
  name: string
  expanded: boolean
  count?: number
  selected?: boolean
  muted?: boolean
  renameable?: boolean
  nameMaxLength?: number
  selectable?: boolean
  labelTitle?: string
}>()
const emit = defineEmits<{
  'update:expanded': [expanded: boolean]
  rename: [name: string]
  select: []
}>()
const { t } = useI18n()
const contentId = useId()
const {
  renaming,
  draft,
  input: renameField,
  start,
  commit: commitRename,
  cancel: cancelRename,
  onMenuClose,
} = useInlineRename({
  value: () => props.name,
  onCommit: name => {
    if (
      props.renameable &&
      (!props.nameMaxLength || name.length <= props.nameMaxLength)
    )
      emit('rename', name)
  },
})
function startRename() {
  if (props.renameable) start()
}
function activate() {
  if (props.selectable) emit('select')
  else emit('update:expanded', !props.expanded)
}
</script>

<template>
  <div
    role="group"
    :aria-label="name"
    class="rounded-lg border bg-card"
    :class="[
      muted && 'opacity-60',
      selected && 'ring-1 ring-primary/40 border-primary/40',
    ]"
  >
    <div class="flex min-h-10 items-center gap-2 px-2 py-1.5">
      <slot name="leading" />
      <Button
        variant="ghost"
        size="icon"
        class="size-7 shrink-0 text-muted-foreground"
        :aria-expanded="expanded"
        :aria-controls="contentId"
        :aria-label="`${t(expanded ? 'general.collapse' : 'general.expand')} ${name}`"
        @click.stop="emit('update:expanded', !expanded)"
      >
        <GroupDisclosure :expanded="expanded" />
      </Button>
      <slot name="icon" :expanded="expanded">
        <component
          :is="expanded ? FolderOpenIcon : FolderIcon"
          class="size-4 shrink-0 text-muted-foreground"
        />
      </slot>
      <div class="min-w-0 flex-1">
        <slot name="label">
          <Input
            v-if="renaming"
            ref="renameField"
            v-model="draft"
            :maxlength="nameMaxLength"
            class="h-6 text-sm"
            @blur="commitRename"
            @keydown.enter.prevent.stop="commitRename"
            @keydown.esc.prevent.stop="cancelRename"
          />
          <button
            v-else
            type="button"
            class="w-full min-w-0 text-left text-sm font-medium"
            :aria-pressed="selectable ? !!selected : undefined"
            :title="labelTitle"
            @click="renameable && !selectable ? startRename() : activate()"
          >
            <span
              class="block truncate"
              :class="
                renameable &&
                'cursor-text hover:underline decoration-dotted underline-offset-2'
              "
              :title="renameable ? t('general.rename') : undefined"
              @click.stop="renameable ? startRename() : activate()"
              >{{ name }}</span
            >
          </button>
        </slot>
      </div>
      <span
        v-if="count !== undefined"
        class="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded bg-muted px-1.5 text-xs tabular-nums text-muted-foreground"
        >{{ count }}</span
      >
      <slot name="details" />
      <div v-if="$slots.actions" class="flex shrink-0 items-center gap-1">
        <slot
          name="actions"
          :startRename="startRename"
          :onMenuClose="onMenuClose"
        />
      </div>
    </div>
    <div v-if="expanded" :id="contentId" class="border-t px-2 py-1.5 pl-5">
      <slot />
    </div>
  </div>
</template>
