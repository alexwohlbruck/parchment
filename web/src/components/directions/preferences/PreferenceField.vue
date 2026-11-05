<script setup lang="ts">
import type { Component } from 'vue'
import { Label } from '@/components/ui/label'
import { SettingsItem } from '@/components/settings'
import { usePreferences } from '@/composables/directions/useRoutingPreferenceControls'

defineProps<{
  label: string
  icon?: Component
  description?: string
  /** Current value in words, e.g. "Prefer flat" or "3.2 mph". */
  hint?: string
  /** The control is a slider: under the label when compact, a fixed width in settings. */
  slider?: boolean
}>()

const { layout } = usePreferences()
</script>

<template>
  <SettingsItem v-if="layout === 'settings'" :title="label" :description="description" :icon="icon">
    <div class="flex shrink-0 items-center gap-3">
      <span v-if="hint" class="text-sm text-muted-foreground tabular-nums whitespace-nowrap">
        {{ hint }}
      </span>
      <div v-if="slider" class="w-28 sm:w-44"><slot /></div>
      <slot v-else />
    </div>
  </SettingsItem>

  <div v-else-if="slider" class="space-y-2">
    <div class="flex items-center justify-between">
      <Label class="text-sm font-normal">{{ label }}</Label>
      <span v-if="hint" class="text-xs text-muted-foreground">{{ hint }}</span>
    </div>
    <slot />
    <slot name="footer" />
    <p v-if="description" class="text-[11px] text-muted-foreground">{{ description }}</p>
  </div>

  <div v-else class="flex items-center justify-between gap-3">
    <Label class="text-sm font-normal">{{ label }}</Label>
    <slot />
  </div>
</template>
