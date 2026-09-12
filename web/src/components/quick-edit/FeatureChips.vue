<script setup lang="ts">
import { CheckIcon, XIcon } from 'lucide-vue-next'
import type { FieldDefinition } from '@/types/quick-edit.types'

/**
 * Yes/no tags as one wrapping row of tri-state chips. A dozen of these as
 * labelled button pairs is most of why the form ran long, and a pair can't
 * show "not answered" — which is the state most of them are actually in.
 */
const props = defineProps<{
  fields: FieldDefinition[]
  tags: Record<string, string>
}>()

const emit = defineEmits<{
  set: [key: string, value: string | null]
}>()

const CYCLE: Record<string, string | null> = { '': 'yes', yes: 'no', no: null }

function state(field: FieldDefinition): 'yes' | 'no' | 'unset' {
  const value = props.tags[field.key]
  if (value === 'yes') return 'yes'
  if (value === 'no') return 'no'
  return 'unset'
}

function cycle(field: FieldDefinition) {
  emit('set', field.key, CYCLE[props.tags[field.key] ?? ''] ?? null)
}
</script>

<template>
  <div class="flex flex-wrap gap-1.5">
    <button
      v-for="field in fields"
      :key="field.id"
      type="button"
      class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors"
      :class="{
        'border-dashed border-border text-muted-foreground hover:border-solid hover:text-foreground':
          state(field) === 'unset',
        'border-transparent bg-primary text-primary-foreground':
          state(field) === 'yes',
        'border-transparent bg-muted text-muted-foreground line-through':
          state(field) === 'no',
      }"
      :aria-pressed="state(field) === 'yes'"
      @click="cycle(field)"
    >
      <CheckIcon v-if="state(field) === 'yes'" class="size-3" />
      <XIcon v-else-if="state(field) === 'no'" class="size-3" />
      {{ field.label }}
    </button>
  </div>
</template>
