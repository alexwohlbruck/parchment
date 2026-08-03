<script setup lang="ts">
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { usePreferences } from './context'

/**
 * A preference measured in real units — speeds, distances — rather than a 0–1
 * weight. The panel owns the unit conversion and exposes the display value
 * through `v-model`, since what's stored (kph, metres) differs from what's
 * shown (mph, minutes) depending on the user's unit system.
 */
defineProps<{
  /** Support key. Renders nothing when the engine doesn't take this. */
  pref: string
  label: string
  /** Rendered to the right of the label, e.g. "18 kph". */
  hint: string
  min: number
  max: number
  step?: number
}>()

const value = defineModel<number>({ required: true })
const { isSupported } = usePreferences()
</script>

<template>
  <div v-if="isSupported(pref)" class="space-y-2">
    <div class="flex items-center justify-between">
      <Label class="text-sm font-normal">{{ label }}</Label>
      <span class="text-xs text-muted-foreground">{{ hint }}</span>
    </div>
    <Slider
      :model-value="[value]"
      :min="min"
      :max="max"
      :step="step ?? 1"
      @update:model-value="v => v && (value = v[0])"
    />
  </div>
</template>
