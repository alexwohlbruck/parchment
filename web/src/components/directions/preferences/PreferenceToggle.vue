<script setup lang="ts">
import { computed, type Component } from 'vue'
import { Switch } from '@/components/ui/switch'
import type { RoutingPreferences } from '@/types/multimodal.types'
import { usePreferences } from '@/composables/directions/useRoutingPreferenceControls'
import PreferenceField from './PreferenceField.vue'

/** A preference that is genuinely a boolean, unlike the weights `PreferenceRow` handles. */
const props = defineProps<{
  pref: keyof RoutingPreferences & string
  label: string
  icon?: Component
}>()

const { preferences, updatePreference, isSupported } = usePreferences()

const value = computed(() => (preferences.value[props.pref] as boolean | undefined) ?? false)
</script>

<template>
  <PreferenceField v-if="isSupported(pref)" :label="label" :icon="icon">
    <Switch :model-value="value" @update:model-value="v => updatePreference(pref, v as never)" />
  </PreferenceField>
</template>
