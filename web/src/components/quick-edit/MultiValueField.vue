<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Combobox,
  ComboboxAnchor,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from '@/components/ui/combobox'
import { ComboboxInput } from 'reka-ui'
import {
  TagsInput,
  TagsInputItem,
  TagsInputItemDelete,
  TagsInputItemText,
} from '@/components/ui/tags-input'

const props = defineProps<{
  modelValue: string[]
  options: Array<{ value: string; label: string }>
  placeholder?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [values: string[]]
}>()

const open = ref(false)
const searchTerm = ref('')

const available = computed(() => {
  const q = searchTerm.value.trim().toLowerCase()
  return props.options.filter(
    (o) =>
      !props.modelValue.includes(o.value) &&
      (!q || o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)),
  )
})

function labelFor(value: unknown): string {
  const v = String(value)
  return props.options.find((o) => o.value === v)?.label ?? v
}

function add(value: string) {
  const v = value.trim()
  if (v && !props.modelValue.includes(v)) {
    emit('update:modelValue', [...props.modelValue, v])
  }
  searchTerm.value = ''
}
</script>

<template>
  <Combobox
    :model-value="modelValue"
    v-model:open="open"
    v-model:search-term="searchTerm"
    multiple
    open-on-focus
    @update:model-value="emit('update:modelValue', $event as string[])"
  >
    <ComboboxAnchor as-child>
      <TagsInput
        :model-value="modelValue"
        :display-value="labelFor"
        class="min-h-9 px-2 gap-1"
        @update:model-value="emit('update:modelValue', $event as string[])"
      >
        <TagsInputItem v-for="value in modelValue" :key="value" :value="value">
          <TagsInputItemText />
          <TagsInputItemDelete />
        </TagsInputItem>
        <ComboboxInput
          :display-value="() => ''"
          :placeholder="placeholder"
          class="text-sm min-h-5 min-w-20 focus:outline-none flex-1 bg-transparent px-1"
          @keydown.enter.prevent="add(searchTerm)"
        />
      </TagsInput>
    </ComboboxAnchor>
    <ComboboxList class="w-[--reka-combobox-trigger-width] max-h-60 overflow-y-auto">
      <ComboboxEmpty v-if="!available.length && !searchTerm.trim()" />
      <ComboboxItem
        v-for="option in available"
        :key="option.value"
        :value="option.value"
        class="cursor-pointer"
      >
        {{ option.label }}
      </ComboboxItem>
    </ComboboxList>
  </Combobox>
</template>
