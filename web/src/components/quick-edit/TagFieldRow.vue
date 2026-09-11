<script setup lang="ts">
import { computed } from 'vue'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
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

const ADDRESS_PARTS = [
  { key: 'addr:housenumber', labelKey: 'quickEdit.address.housenumber', span: 'col-span-1' },
  { key: 'addr:street', labelKey: 'quickEdit.address.street', span: 'col-span-2' },
  { key: 'addr:city', labelKey: 'quickEdit.address.city', span: 'col-span-2' },
  { key: 'addr:postcode', labelKey: 'quickEdit.address.postcode', span: 'col-span-1' },
]

const widget = computed(() => {
  if (props.field.key === 'opening_hours') return 'hours'
  if (props.field.type === 'address') return 'address'
  switch (props.field.type) {
    case 'check':
    case 'defaultCheck':
    case 'onewayCheck':
      return 'check'
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
    <Label class="text-xs text-muted-foreground">{{ field.label }}</Label>

    <OpeningHoursField
      v-if="widget === 'hours'"
      :model-value="value"
      @update:model-value="set"
    />

    <ToggleGroup
      v-else-if="widget === 'check'"
      type="single"
      :model-value="value"
      class="justify-start gap-1"
      @update:model-value="set(($event as string) ?? '')"
    >
      <ToggleGroupItem value="yes" class="h-8 px-3 text-xs">
        {{ $t('general.yes') }}
      </ToggleGroupItem>
      <ToggleGroupItem value="no" class="h-8 px-3 text-xs">
        {{ $t('general.no') }}
      </ToggleGroupItem>
    </ToggleGroup>

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

    <div v-else-if="widget === 'address'" class="grid grid-cols-3 gap-1.5">
      <Input
        v-for="part in ADDRESS_PARTS"
        :key="part.key"
        :model-value="tags[part.key] ?? ''"
        :placeholder="$t(part.labelKey)"
        :class="part.span"
        @update:model-value="emit('set', part.key, String($event) || null)"
      />
    </div>

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
