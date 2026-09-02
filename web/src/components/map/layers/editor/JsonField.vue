<script setup lang="ts">
/**
 * A JSON escape hatch: filters, expressions, and the raw layer configuration
 * all end up here. Edits are only committed once they parse, so a half-typed
 * bracket never wipes the value it is replacing — the error just sits under
 * the field until it is closed.
 */
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Textarea } from '@/components/ui/textarea'

const props = withDefaults(
  defineProps<{
    modelValue: unknown
    rows?: number
    placeholder?: string
    /** Allow clearing the field to mean "unset" rather than a parse error. */
    nullable?: boolean
  }>(),
  { rows: 8, nullable: true },
)

const emit = defineEmits<{ 'update:modelValue': [value: unknown] }>()

const { t } = useI18n()

const text = ref(serialise(props.modelValue))
const error = ref<string | null>(null)

function serialise(value: unknown): string {
  if (value === undefined || value === null) return ''
  return JSON.stringify(value, null, 2)
}

// Re-sync when the value changes underneath us (a preset applied, a different
// property opened), but not while the user is mid-edit with a parse error.
watch(
  () => props.modelValue,
  value => {
    if (error.value) return
    const next = serialise(value)
    if (next !== text.value) text.value = next
  },
)

function commit(next: string) {
  text.value = next
  if (!next.trim()) {
    error.value = props.nullable ? null : t('layers.editor.errors.invalidJson')
    if (props.nullable) emit('update:modelValue', undefined)
    return
  }
  try {
    emit('update:modelValue', JSON.parse(next))
    error.value = null
  } catch {
    error.value = t('layers.editor.errors.invalidJson')
  }
}
</script>

<template>
  <div class="space-y-1.5">
    <Textarea
      :model-value="text"
      :rows="rows"
      :placeholder="placeholder"
      spellcheck="false"
      class="font-mono text-xs leading-relaxed"
      :class="error && 'border-destructive focus-visible:ring-destructive'"
      @update:model-value="v => commit(String(v))"
    />
    <p v-if="error" class="text-xs text-destructive">{{ error }}</p>
  </div>
</template>
