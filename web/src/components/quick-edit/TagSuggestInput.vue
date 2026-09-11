<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import { Input } from '@/components/ui/input'
import { useQuickEditService } from '@/services/quick-edit.service'
import type { TagSuggestion } from '@/types/quick-edit.types'

/**
 * A tag key or value input backed by the tagging schema's documented tags.
 * Free text always wins — the suggestions are a shortcut, not a whitelist.
 */
const props = defineProps<{
  modelValue: string
  placeholder?: string
  /** Set to suggest values for that key; omit to suggest keys. */
  forKey?: string
}>()

const emit = defineEmits<{
  commit: [value: string]
}>()

const quickEditService = useQuickEditService()

// Edits are held locally and committed on blur or selection: renaming a tag
// key on every keystroke would rewrite the tag map letter by letter.
const draft = ref(props.modelValue)
watch(() => props.modelValue, (value) => { draft.value = value })

const suggestions = ref<TagSuggestion[]>([])
const open = ref(false)
const active = ref(-1)

let debounce: ReturnType<typeof setTimeout> | undefined

function load(query: string) {
  clearTimeout(debounce)
  debounce = setTimeout(async () => {
    try {
      suggestions.value = await quickEditService.suggestTags(query, props.forKey)
      active.value = -1
      open.value = suggestions.value.length > 0
    } catch {
      suggestions.value = []
    }
  }, 150)
}

onUnmounted(() => clearTimeout(debounce))

function onInput(value: string) {
  draft.value = value
  load(value)
}

function commit() {
  open.value = false
  if (draft.value !== props.modelValue) emit('commit', draft.value)
}

function choose(suggestion: TagSuggestion) {
  draft.value = suggestion.value
  suggestions.value = []
  commit()
}

function onKeydown(event: KeyboardEvent) {
  if (!open.value || !suggestions.value.length) return
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    active.value = (active.value + 1) % suggestions.value.length
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    active.value =
      (active.value - 1 + suggestions.value.length) % suggestions.value.length
  } else if (event.key === 'Enter') {
    event.preventDefault()
    if (active.value >= 0) choose(suggestions.value[active.value])
    else commit()
  } else if (event.key === 'Escape') {
    open.value = false
  }
}
</script>

<template>
  <div class="relative">
    <Input
      :model-value="draft"
      :placeholder="placeholder"
      class="h-8 font-mono text-xs"
      @update:model-value="onInput(String($event))"
      @focus="load(draft)"
      @blur="commit"
      @keydown="onKeydown"
    />
    <div
      v-if="open"
      class="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md"
    >
      <button
        v-for="(suggestion, index) in suggestions"
        :key="suggestion.value"
        type="button"
        class="flex w-full items-baseline gap-2 rounded px-2 py-1 text-left font-mono text-xs"
        :class="index === active ? 'bg-accent' : 'hover:bg-accent'"
        @mousedown.prevent="choose(suggestion)"
      >
        <span class="truncate">{{ suggestion.value }}</span>
        <span
          v-if="suggestion.label"
          class="ml-auto shrink-0 truncate font-sans text-[10px] text-muted-foreground"
        >
          {{ suggestion.label }}
        </span>
      </button>
    </div>
  </div>
</template>
