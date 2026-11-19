<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { UnitSystem as MeasureUnitSystem } from '@/lib/measure/measure'

const model = defineModel<MeasureUnitSystem>({ required: true })

const { t } = useI18n()

const OPTIONS = [
  { value: 'metric', short: 'measure.unitsMetricShort', label: 'measure.unitsMetric' },
  { value: 'imperial', short: 'measure.unitsImperialShort', label: 'measure.unitsImperial' },
] as const
</script>

<template>
  <ToggleGroup
    type="single"
    :model-value="model"
    :aria-label="t('measure.units')"
    class="gap-0 rounded-md bg-muted/70 p-0.5"
    @update:model-value="value => value && (model = value as MeasureUnitSystem)"
  >
    <ToggleGroupItem
      v-for="option in OPTIONS"
      :key="option.value"
      :value="option.value"
      :aria-label="t(option.label)"
      variant="ghost"
      class="h-6 min-w-0 rounded-[5px] px-2 py-0 text-[11px] font-medium text-muted-foreground hover:bg-transparent hover:text-foreground active:translate-y-0 data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-xs"
    >
      {{ t(option.short) }}
    </ToggleGroupItem>
  </ToggleGroup>
</template>
