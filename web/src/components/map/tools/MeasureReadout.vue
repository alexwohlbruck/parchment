<script setup lang="ts">
import { Label } from '@/components/ui/label'

/**
 * One measured quantity. The value is a button: tapping it cycles the unit,
 * which is why it carries focus styles despite looking like text.
 */
defineProps<{
  label: string
  /** Formatted value, or null when there's nothing measured yet. */
  value: string | null
  cycleLabel: string
  /** The figure the tool exists to give you, set large above the rest. */
  prominent?: boolean
}>()

defineEmits<{ cycle: [] }>()
</script>

<template>
  <div
    :class="
      prominent
        ? 'flex flex-col items-start gap-0.5'
        : 'flex items-baseline justify-between gap-4'
    "
  >
    <Label class="shrink-0 text-[11px] font-medium text-muted-foreground">
      {{ label }}
    </Label>
    <button
      type="button"
      class="-mx-1 cursor-pointer rounded bg-transparent px-1 text-foreground tabular-nums transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      :class="
        prominent
          ? 'text-left text-[26px] font-semibold leading-tight tracking-[-0.03em]'
          : 'text-right text-[13px] font-medium tracking-[-0.02em]'
      "
      :aria-label="cycleLabel"
      @click="$emit('cycle')"
    >
      {{ value ?? '—' }}
    </button>
  </div>
</template>
