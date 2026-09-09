<script setup lang="ts">
/**
 * A number on the tool options bar: what it is set to, and a slider to change
 * it, behind one small button.
 *
 * A slider laid out inline would be the widest thing on a bar that already
 * has to fit over a phone-sized map, so the value itself is the control —
 * it reads at a glance and opens to be set.
 */
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Slider } from '@/components/ui/slider'

const props = defineProps<{
  label: string
  modelValue: number
  min: number
  max: number
  step: number
  /** What the button shows. Defaults to the value itself. */
  display?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: number] }>()
</script>

<template>
  <Popover>
    <PopoverTrigger as-child>
      <Button
        variant="ghost"
        size="sm"
        class="h-8 gap-1.5 px-2"
        :title="label"
        :aria-label="`${label}: ${display ?? modelValue}`"
      >
        <!-- A glyph that shows the setting rather than naming it: a bar at
             the chosen thickness, a swatch at the chosen opacity. -->
        <slot name="glyph" />
        <!-- Fixed width: the bar is centred, so a value growing a digit
             would nudge every control beside it. -->
        <span class="text-xs tabular-nums text-center min-w-9">
          {{ display ?? modelValue }}
        </span>
      </Button>
    </PopoverTrigger>
    <PopoverContent class="w-48 p-3" align="center">
      <p class="text-xs text-muted-foreground mb-2">{{ label }}</p>
      <Slider
        :model-value="[props.modelValue]"
        :min="min"
        :max="max"
        :step="step"
        @update:model-value="v => emit('update:modelValue', v?.[0] ?? props.min)"
      />
    </PopoverContent>
  </Popover>
</template>
