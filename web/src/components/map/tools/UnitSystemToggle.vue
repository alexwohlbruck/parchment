<script setup lang="ts">
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { UnitSystem as MeasureUnitSystem } from '@/lib/measure.utils'

/**
 * Metric ⟷ imperial for a measuring panel. Labelled on both sides rather than
 * one side plus a checkbox, since neither option is the "off" state.
 */
defineProps<{
  metricLabel: string
  imperialLabel: string
}>()

const model = defineModel<MeasureUnitSystem>({ required: true })
</script>

<template>
  <div class="mt-1 flex items-center justify-between gap-3">
    <Label class="text-[11px] font-medium text-muted-foreground">
      {{ metricLabel }}
    </Label>
    <div class="flex flex-1 justify-center">
      <Switch
        :model-value="model === 'imperial'"
        aria-label="Metric or Imperial units"
        @update:model-value="v => (model = v ? 'imperial' : 'metric')"
      />
    </div>
    <Label class="shrink-0 text-[11px] font-medium text-muted-foreground">
      {{ imperialLabel }}
    </Label>
  </div>
</template>
