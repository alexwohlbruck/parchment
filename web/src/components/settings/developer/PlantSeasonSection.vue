<!--
  Plant season — DEV ONLY, rendered by the Developer settings page.

  Pins the plants, grass and woods to a day of the year instead of today, to
  check a season without waiting for it.
-->

<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { LeafIcon } from 'lucide-vue-next'
import { SettingsSection, SettingsItem } from '@/components/settings'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { useMapStore } from '@/stores/map.store'
import { dayOfYear } from '@/lib/map-objects/seasons'

const { settings } = storeToRefs(useMapStore())

const day = computed(() => settings.value.plantDay ?? dayOfYear(new Date()))
const label = computed(() =>
  new Date(2026, 0, 1 + day.value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
)
</script>

<template>
  <SettingsSection id="plant-season" title="Plant season">
    <SettingsItem
      title="Day of the year"
      :description="settings.plantDay == null ? 'Following today' : 'Pinned'"
      :icon="LeafIcon"
    >
      <div class="flex min-w-0 items-center gap-2">
        <Button
          v-if="settings.plantDay != null"
          variant="ghost"
          size="sm"
          @click="settings.plantDay = null"
        >
          Today
        </Button>
        <span class="w-14 text-right text-sm text-muted-foreground font-medium">{{ label }}</span>
        <Slider
          class="w-40 min-w-0"
          :model-value="[day]"
          :min="0"
          :max="364"
          :step="1"
          aria-label="Day of the year"
          @update:model-value="v => v && (settings.plantDay = v[0])"
        />
      </div>
    </SettingsItem>
  </SettingsSection>
</template>
