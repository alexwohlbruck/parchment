<!--
  Building lighting — DEV ONLY, rendered by the Developer settings page.

  The controls themselves live in `useBuildingShadeTuner`, shared with the
  floating popover, because the settings dialog covers the map: you cannot see
  what a slider is doing from in here. "Tune over the map" closes settings and
  reopens the same levers as a small panel beside the live map.
-->

<script setup lang="ts">
import { useRouter } from 'vue-router'
import { BuildingIcon, CopyIcon, RotateCcwIcon, PictureInPictureIcon } from 'lucide-vue-next'
import { SettingsSection, SettingsItem } from '@/components/settings'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import {
  useBuildingShadeTuner,
  SHADE_GROUPS,
  SHADE_POPOVER_KEY,
} from '@/composables/useBuildingShadeTuner'

const router = useRouter()
const { state, toggles, isMaplibre, copied, setLever, reset, copyDefaults } = useBuildingShadeTuner()

function tuneOverMap() {
  sessionStorage.setItem(SHADE_POPOVER_KEY, '1')
  router.push('/')
}
</script>

<template>
  <SettingsSection
    id="building-shading"
    :title="$t('settings.developer.buildingShading.title')"
    :description="$t('settings.developer.buildingShading.description')"
  >
    <SettingsItem
      v-if="!isMaplibre"
      title="MapLibre only"
      description="The Mapbox engine lights its buildings itself and ignores these. Switch the map engine under Behavior to use them."
      :icon="BuildingIcon"
    />

    <template v-else>
      <SettingsItem
        title="Tune over the map"
        description="Reopens these controls as a small panel beside the live map, since this dialog covers it."
        :icon="PictureInPictureIcon"
      >
        <Button size="sm" @click="tuneOverMap">Open preview</Button>
      </SettingsItem>

      <SettingsItem
        title="Enabled"
        description="Turn the whole effect off to compare against plain extrusions."
        :icon="BuildingIcon"
      >
        <Switch :model-value="toggles.enabled" @update:model-value="toggles.enabled = $event" />
      </SettingsItem>

      <template v-for="group in SHADE_GROUPS" :key="group.title">
        <SettingsItem v-if="group.toggle" :title="group.toggle.label">
          <Switch
            :model-value="toggles[group.toggle.key]"
            @update:model-value="toggles[group.toggle.key] = $event"
          />
        </SettingsItem>

        <SettingsItem
          v-for="lever in group.levers"
          :key="lever.key"
          :title="lever.label"
          :description="group.title"
          block
        >
          <div class="flex items-center gap-3 w-56">
            <Slider
              class="flex-1"
              :min="lever.min"
              :max="lever.max"
              :step="lever.step"
              :model-value="[state[lever.key]]"
              @update:model-value="setLever(lever.key, $event ?? undefined)"
            />
            <span class="text-xs text-muted-foreground tabular-nums w-12 text-right">
              {{ lever.format ? lever.format(state[lever.key]) : Math.round(state[lever.key]) }}
            </span>
          </div>
        </SettingsItem>
      </template>

      <SettingsItem
        title="Save these values"
        description="Copies the current settings in the shape building-shade.ts expects."
        :icon="CopyIcon"
      >
        <div class="flex gap-2">
          <Button variant="outline" size="sm" @click="reset">
            <RotateCcwIcon class="size-4" />
            Reset
          </Button>
          <Button size="sm" @click="copyDefaults">
            {{ copied ? 'Copied' : 'Copy defaults' }}
          </Button>
        </div>
      </SettingsItem>
    </template>
  </SettingsSection>
</template>
