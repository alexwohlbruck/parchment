<script setup lang="ts">
import { computed } from 'vue'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import WikiLink from './WikiLink.vue'
import { fieldWikiUrl } from '@/lib/quick-edit/osm-wiki'
import ComboField from './ComboField.vue'
import MultiValueField from './MultiValueField.vue'
import OpeningHoursField from './OpeningHoursField.vue'
import type { FieldDefinition } from '@/types/quick-edit.types'

const props = defineProps<{
  field: FieldDefinition
  tags: Record<string, string>
}>()

const emit = defineEmits<{
  set: [key: string, value: string | null]
}>()

/** The key currently holding this field's value (fields may list fallbacks
 *  like contact:phone); writes go back to the same key. */
const activeKey = computed(() => {
  const keys = (props.field as any).keys as string[] | undefined
  if (keys) {
    const present = keys.find((k) => props.tags[k] !== undefined)
    if (present) return present
  }
  return props.field.key
})

const value = computed(() => props.tags[activeKey.value] ?? '')

const options = computed(() =>
  Object.entries(props.field.options ?? {}).map(([optionValue, label]) => ({
    value: optionValue,
    label: typeof label === 'string' ? label : label.title,
  })),
)

const widget = computed(() => {
  if (props.field.key === 'opening_hours') return 'hours'
  switch (props.field.type) {
    case 'combo':
    case 'typeCombo':
    case 'networkCombo':
    case 'access':
      return options.value.length ? 'combo' : 'text'
    case 'semiCombo':
    case 'manyCombo':
      return 'multi'
    case 'multiCombo':
      return 'multiPrefix'
    case 'number':
    case 'roadspeed':
    case 'roadheight':
      return 'number'
    case 'tel':
      return 'tel'
    case 'url':
      return 'url'
    case 'email':
      return 'email'
    case 'textarea':
      return 'textarea'
    default:
      return 'text'
  }
})

function set(newValue: string) {
  emit('set', activeKey.value, newValue || null)
}

// semiCombo values are ;-separated on one key
const multiValues = computed(() =>
  value.value ? value.value.split(';').map((v) => v.trim()).filter(Boolean) : [],
)

function setMulti(values: string[]) {
  set(values.join(';'))
}

// multiCombo keys are prefixed booleans, e.g. currency:USD=yes
const prefixValues = computed(() =>
  Object.entries(props.tags)
    .filter(([k, v]) => k.startsWith(props.field.key) && v === 'yes')
    .map(([k]) => k.slice(props.field.key.length)),
)

function setPrefix(values: string[]) {
  for (const existing of prefixValues.value) {
    if (!values.includes(existing)) {
      emit('set', props.field.key + existing, null)
    }
  }
  for (const added of values) {
    emit('set', props.field.key + added, 'yes')
  }
}
</script>

<template>
  <div class="space-y-1">
    <div class="flex items-center gap-1">
      <Label class="text-xs text-muted-foreground">{{ field.label }}</Label>
      <WikiLink :url="fieldWikiUrl(field, tags)" :label="field.label" />
    </div>

    <OpeningHoursField
      v-if="widget === 'hours'"
      :model-value="value"
      @update:model-value="set"
    />

    <ComboField
      v-else-if="widget === 'combo'"
      :model-value="value"
      :options="options"
      :placeholder="field.placeholder"
      @update:model-value="set"
    />

    <MultiValueField
      v-else-if="widget === 'multi'"
      :model-value="multiValues"
      :options="options"
      :placeholder="field.placeholder"
      @update:model-value="setMulti"
    />

    <MultiValueField
      v-else-if="widget === 'multiPrefix'"
      :model-value="prefixValues"
      :options="options"
      :placeholder="field.placeholder"
      @update:model-value="setPrefix"
    />

    <Textarea
      v-else-if="widget === 'textarea'"
      :model-value="value"
      :placeholder="field.placeholder"
      :rows="2"
      @update:model-value="set(String($event))"
    />

    <Input
      v-else
      :model-value="value"
      :type="widget === 'number' ? 'number' : widget"
      :placeholder="field.placeholder"
      @update:model-value="set(String($event))"
    />
  </div>
</template>
