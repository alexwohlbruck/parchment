<script setup lang="ts">
import { Label } from '@/components/ui/label'

/**
 * One measured quantity — "Distance   1.2 km". The value is a button: tapping
 * it cycles the unit, which is why it carries focus styles despite looking
 * like text.
 */
defineProps<{
  label: string
  /** Formatted value, or null when there's nothing measured yet. */
  value: string | null
  cycleLabel: string
}>()

defineEmits<{ cycle: [] }>()
</script>

<template>
  <div class="flex items-baseline justify-between gap-4">
    <Label class="shrink-0 text-[11px] font-medium text-muted-foreground">
      {{ label }}
    </Label>
    <button
      type="button"
      class="cursor-pointer rounded -mx-1 bg-transparent px-1 text-right text-[13px] font-medium tracking-[-0.02em] text-foreground tabular-nums transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      :aria-label="cycleLabel"
      @click="$emit('cycle')"
    >
      {{ value ?? '—' }}
    </button>
  </div>
</template>
