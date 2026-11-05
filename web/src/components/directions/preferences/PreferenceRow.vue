<script setup lang="ts">
import { computed, type Component } from 'vue'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import type { RoutingPreferences } from '@/types/multimodal.types'
import { usePreferences } from '@/composables/directions/useRoutingPreferenceControls'
import PreferenceField from './PreferenceField.vue'

/** A 0–1 slider where the engine takes a weight, or a switch with its own directional label where it only takes a flag. */
const props = withDefaults(
  defineProps<{
    /** Preference key; also the lookup for support level and hint wording. */
    pref: keyof RoutingPreferences & string
    /** Neutral label for the slider form. */
    label: string
    icon?: Component
    /** Value used when the preference is unset. */
    fallback?: number
    /** Directional label for the switch form; without it the preference only renders as a slider. */
    toggleLabel?: string
    /** Value written when the switch is on / off. */
    on?: number
    off?: number
    /** Which side of the midpoint reads as "on": `below` for avoid-style switches. */
    toggleWhen?: 'above' | 'below'
    /** Captions under the slider ends in the compact layout, e.g. ['Safest', 'Fastest']. */
    endLabels?: [string, string]
  }>(),
  { fallback: 0.5, toggleWhen: 'above' },
)

const { preferences, updatePreference, isSupported, isRange, getHintLabel } = usePreferences()

const value = computed(() => (preferences.value[props.pref] as number | undefined) ?? props.fallback)

const checked = computed(() =>
  props.toggleWhen === 'below' ? value.value < 0.5 : value.value > 0.5,
)

function setWeight(next: number[] | undefined) {
  if (next) updatePreference(props.pref, next[0] as never)
}

function setFlag(next: boolean) {
  updatePreference(props.pref, (next ? props.on : props.off) as never)
}
</script>

<template>
  <template v-if="isSupported(pref)">
    <PreferenceField v-if="isRange(pref)" :label="label" :icon="icon" :hint="getHintLabel(pref, value)" slider>
      <Slider :model-value="[value]" :min="0" :max="1" :step="0.01" @update:model-value="setWeight" />
      <template v-if="endLabels" #footer>
        <div class="flex justify-between text-xs text-muted-foreground">
          <span>{{ endLabels[0] }}</span>
          <span>{{ endLabels[1] }}</span>
        </div>
      </template>
    </PreferenceField>

    <PreferenceField v-else-if="toggleLabel" :label="toggleLabel" :icon="icon">
      <Switch :model-value="checked" @update:model-value="setFlag" />
    </PreferenceField>
  </template>
</template>
