<script setup lang="ts">
import { ref, watch } from 'vue'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Span } from '@/components/ui/typography'
import { Slider } from '@/components/ui/slider'
import { Button } from '@/components/ui/button'
import { CheckIcon } from 'lucide-vue-next'
import {
  allRadii,
  useThemeStore,
  allColors,
} from '@/stores/settings/theme.store'
import { colors } from '@/lib/registry/colors'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { SettingsSection, SettingsItem } from '@/components/settings'

const mapTheme = ref('auto')

// Theme store
const themeStore = useThemeStore()
const { isDark, accentColor, radius } = storeToRefs(themeStore)
const { toggleDark, setAccentColor, setRadius } = themeStore

// Convert radius to slider format (array)
const sliderRadius = ref([radius.value])

// Keep sliderRadius in sync with radius from store
watch(radius, newValue => {
  sliderRadius.value = [newValue]
})

// Function to update radius when slider changes
const updateRadius = (value: number[] | undefined) => {
  if (value && value.length > 0) {
    setRadius(value[0])
  }
}

// Function to handle theme color selection
const handleColorChange = (value: string) => {
  // The setAccentColor function expects a value from allColors
  // This cast is safe since we're only passing values from allColors in the UI
  setAccentColor(value as (typeof allColors)[number])
}
</script>

<template>
  <div class="flex flex-col gap-4 w-fit">
    <SettingsSection :title="$t('settings.appearance.appTheme.title')">
      <SettingsItem :title="$t('settings.appearance.appTheme.color.title')">
        <Select
          :model-value="accentColor"
          @update:model-value="handleColorChange"
        >
          <SelectTrigger class="w-fit">
            <SelectValue placeholder="Choose an option" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem
                v-for="color in allColors"
                :key="color"
                :value="color"
              >
                <div class="flex items-center gap-2">
                  <div
                    class="w-2.5 h-2.5 rounded-full"
                    :style="{ backgroundColor: colors[color][5].rgb }"
                  ></div>
                  <Span>{{
                    $t(`settings.appearance.appTheme.color.values.${color}`)
                  }}</Span>
                </div>
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </SettingsItem>

      <SettingsItem :title="$t('settings.appearance.appTheme.radius.title')">
        <div class="flex items-center gap-2">
          <Span class="text-sm text-muted-foreground font-medium">
            {{ sliderRadius[0] }}
          </Span>
          <Slider
            v-model="sliderRadius"
            class="w-48"
            :default-value="[0.5]"
            :max="1"
            :step="0.25"
            @update:model-value="updateRadius"
          />
        </div>
      </SettingsItem>

      <SettingsItem :title="$t('settings.appearance.appTheme.theme.title')">
        <Select
          :model-value="isDark ? 'dark' : 'light'"
          @update:model-value="value => toggleDark(value === 'dark')"
        >
          <SelectTrigger class="w-fit">
            <SelectValue placeholder="Choose an option" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="light">
              {{ $t('settings.appearance.appTheme.theme.values.light') }}
            </SelectItem>
            <SelectItem value="dark">
              {{ $t('settings.appearance.appTheme.theme.values.dark') }}
            </SelectItem>
          </SelectContent>
        </Select>
      </SettingsItem>
    </SettingsSection>

    <SettingsSection :title="$t('settings.appearance.mapTheme.title')">
      <SettingsItem :title="$t('settings.appearance.mapTheme.title')">
        <Select v-model="mapTheme">
          <SelectTrigger class="w-fit">
            <SelectValue placeholder="Choose an option" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="auto">
                {{ $t('settings.appearance.mapTheme.values.matchTime') }}
              </SelectItem>
              <SelectItem value="match">{{
                $t('settings.appearance.mapTheme.values.match')
              }}</SelectItem>
              <SelectItem value="light">{{
                $t('settings.appearance.mapTheme.values.day')
              }}</SelectItem>
              <SelectItem value="dark">{{
                $t('settings.appearance.mapTheme.values.night')
              }}</SelectItem>
              <SelectItem value="dawn">{{
                $t('settings.appearance.mapTheme.values.dawn')
              }}</SelectItem>
              <SelectItem value="dusk">{{
                $t('settings.appearance.mapTheme.values.dusk')
              }}</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </SettingsItem>
    </SettingsSection>
  </div>
</template>
