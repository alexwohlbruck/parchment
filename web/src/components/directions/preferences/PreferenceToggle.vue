<script setup lang="ts">
import { computed } from 'vue'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { RoutingPreferences } from '@/types/multimodal.types'
import { usePreferences } from './context'

/**
 * A preference that is genuinely a boolean — wheelchair access, HOV lanes —
 * as opposed to a weight the engine might expose either way. Use
 * `PreferenceRow` for those.
 */
const props = defineProps<{
  pref: keyof RoutingPreferences & string
  label: string
}>()

const { preferences, updatePreference, isSupported } = usePreferences()

const value = computed(
  () => (preferences.value[props.pref] as boolean | undefined) ?? false,
)
</script>

<template>
  <div
    v-if="isSupported(pref)"
    class="flex items-center justify-between"
  >
    <Label class="text-sm font-normal">{{ label }}</Label>
    <Switch
      :model-value="value"
      @update:model-value="v => updatePreference(pref, v as never)"
    />
  </div>
</template>
