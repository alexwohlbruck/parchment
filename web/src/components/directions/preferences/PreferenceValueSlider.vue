<script setup lang="ts">
import type { Component } from 'vue'
import { Slider } from '@/components/ui/slider'
import { usePreferences } from '@/composables/directions/useRoutingPreferenceControls'
import PreferenceField from './PreferenceField.vue'

/**
 * A preference in real units (speeds, distances) rather than a 0–1 weight. The
 * caller converts units and exposes the display value through `v-model`.
 */
defineProps<{
  /** Support key. Renders nothing when the engine doesn't take this. */
  pref: string
  label: string
  icon?: Component
  description?: string
  /** The value in words, e.g. "18 kph". */
  hint: string
  min: number
  max: number
  step?: number
}>()

const value = defineModel<number>({ required: true })
const { isSupported } = usePreferences()
</script>

<template>
  <PreferenceField
    v-if="isSupported(pref)"
    :label="label"
    :icon="icon"
    :description="description"
    :hint="hint"
    slider
  >
    <Slider
      :model-value="[value]"
      :min="min"
      :max="max"
      :step="step ?? 1"
      @update:model-value="v => v && (value = v[0])"
    />
  </PreferenceField>
</template>
