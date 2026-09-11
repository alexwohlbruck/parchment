<script setup lang="ts">
import { computed, ref } from 'vue'
import ResponsivePopover from '@/components/responsive/ResponsivePopover.vue'
import { TimePicker } from '@/components/ui/time-picker'
import { formatClockTime } from '@/lib/time-format'

/**
 * A time of day shown as a chip, dialled through the app's own picker.
 * `<input type="time">` renders as a different, oversized control on every
 * platform, which is what made the hours editor so tall.
 */
const props = defineProps<{
  modelValue: string
  /** Earliest selectable time, so a closing time can't precede its opening. */
  min?: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const open = ref(false)

// OSM writes 24:00 for "through to midnight"; the picker only dials 00:00-23:59.
const dialled = computed(() =>
  props.modelValue === '24:00' ? '23:59' : props.modelValue,
)

const label = computed(() => formatClockTime(props.modelValue) ?? props.modelValue)
</script>

<template>
  <ResponsivePopover v-model:open="open" fit-content>
    <template #trigger>
      <button
        type="button"
        class="rounded-md border border-input px-2 py-1 text-xs tabular-nums transition-colors hover:bg-accent"
      >
        {{ label }}
      </button>
    </template>
    <TimePicker
      :model-value="dialled"
      :min="min"
      @update:model-value="emit('update:modelValue', $event)"
    />
  </ResponsivePopover>
</template>
