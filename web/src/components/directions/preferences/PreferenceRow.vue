<script setup lang="ts">
import { computed } from 'vue'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import type { RoutingPreferences } from '@/types/multimodal.types'
import { usePreferences } from './context'

/**
 * A weighted routing preference, rendered to match what the active engine
 * supports: a 0–1 slider where the engine takes a weight, or an on/off switch
 * where it only takes a flag. Renders nothing when the engine has no support.
 *
 * The two forms word themselves differently — the slider is neutral ("Hills")
 * because it spans both directions, while the switch has to pick a side
 * ("Avoid hills"), so each takes its own label.
 */
const props = withDefaults(
  defineProps<{
    /** Preference key; also the lookup for support level and hint wording. */
    pref: keyof RoutingPreferences & string
    /** Neutral label for the slider form. */
    label: string
    /** Value used when the preference is unset. */
    fallback?: number
    /** Directional label for the switch form. Omit if the preference has no
        sensible on/off reading — it then only renders as a slider. */
    toggleLabel?: string
    /** Value written when the switch is on / off. */
    on?: number
    off?: number
    /**
     * Which side of the midpoint reads as "on". `below` suits an avoid-style
     * switch (Avoid hills), `above` a prefer-style one (Prefer lit paths).
     */
    toggleWhen?: 'above' | 'below'
    /** Captions under the slider ends, e.g. ['Safest', 'Fastest']. */
    endLabels?: [string, string]
  }>(),
  { fallback: 0.5, toggleWhen: 'above' },
)

const { preferences, updatePreference, isSupported, isRange, getHintLabel } =
  usePreferences()

const value = computed(
  () => (preferences.value[props.pref] as number | undefined) ?? props.fallback,
)

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
  <div v-if="isSupported(pref)">
    <template v-if="isRange(pref)">
      <div class="flex items-center justify-between mb-2">
        <Label class="text-sm font-normal">{{ label }}</Label>
        <span class="text-xs text-muted-foreground">
          {{ getHintLabel(pref, value) }}
        </span>
      </div>
      <Slider
        :model-value="[value]"
        :min="0"
        :max="1"
        :step="0.01"
        @update:model-value="setWeight"
      />
      <div
        v-if="endLabels"
        class="flex justify-between text-xs text-muted-foreground mt-1"
      >
        <span>{{ endLabels[0] }}</span>
        <span>{{ endLabels[1] }}</span>
      </div>
    </template>

    <div v-else-if="toggleLabel" class="flex items-center justify-between">
      <Label class="text-sm font-normal">{{ toggleLabel }}</Label>
      <Switch :model-value="checked" @update:model-value="setFlag" />
    </div>
  </div>
</template>
