<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Combobox,
  ComboboxAnchor,
  ComboboxList,
  ComboboxItem,
} from '@/components/ui/combobox'
import { ComboboxInput } from 'reka-ui'

const props = defineProps<{
  modelValue?: string
  options: Array<{ value: string; label: string }>
  placeholder?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const open = ref(false)
const searchTerm = ref('')

const filtered = computed(() => {
  const q = searchTerm.value.trim().toLowerCase()
  if (!q) return props.options
  return props.options.filter(
    (o) =>
      o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
  )
})

const isCustomTerm = computed(() => {
  const q = searchTerm.value.trim()
  return q && !props.options.some((o) => o.value === q)
})

function displayValue(value: unknown): string {
  const option = props.options.find((o) => o.value === value)
  return option?.label ?? (value as string) ?? ''
}

function select(value: string) {
  emit('update:modelValue', value)
  searchTerm.value = ''
  open.value = false
}
</script>

<template>
  <Combobox
    :model-value="modelValue ?? ''"
    v-model:open="open"
    v-model:search-term="searchTerm"
    open-on-focus
    :reset-search-term-on-blur="true"
    @update:model-value="select(($event as string) ?? '')"
  >
    <ComboboxAnchor as-child>
      <ComboboxInput
        :display-value="displayValue"
        :placeholder="placeholder"
        class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </ComboboxAnchor>
    <ComboboxList class="w-[--reka-combobox-trigger-width] max-h-60 overflow-y-auto">
      <ComboboxItem
        v-for="option in filtered"
        :key="option.value"
        :value="option.value"
        class="cursor-pointer"
      >
        {{ option.label }}
      </ComboboxItem>
      <ComboboxItem
        v-if="isCustomTerm"
        :value="searchTerm.trim()"
        class="cursor-pointer text-muted-foreground"
      >
        “{{ searchTerm.trim() }}”
      </ComboboxItem>
    </ComboboxList>
  </Combobox>
</template>
