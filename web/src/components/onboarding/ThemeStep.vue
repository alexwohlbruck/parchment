<script setup lang="ts">
import { computed, inject, onMounted, watch } from 'vue'
import { useStorage } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useThemeStore, allColors } from '@/stores/theme.store'
import { useAppStore } from '@/stores/app.store'
import { useAuthStore } from '@/stores/auth.store'
import { useCommandStore, CommandName } from '@/stores/command.store'
import { palette } from '@/lib/palette'
import type { PaletteColor } from '@/lib/palette'
import { UnitSystem } from '@/types/map.types'
import type { Locale } from '@/lib/i18n'
import { updatePreferences } from '@/services/preferences.service'
import { Sun, Moon, Monitor, Check } from 'lucide-vue-next'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { validateKey } from './types'

const { t, locale } = useI18n()
const themeStore = useThemeStore()
const appStore = useAppStore()
const authStore = useAuthStore()
const commandStore = useCommandStore()
const { accentColor } = storeToRefs(themeStore)
const { setAccentColor } = themeStore
const { unitSystem } = storeToRefs(appStore)

const languageOptions = computed(() =>
  commandStore.getCommandArgumentOptions(
    CommandName.UPDATE_LANGUAGE,
    'language',
  ),
)

const colorScheme = useStorage('vueuse-color-scheme', 'auto')

const currentMode = computed(() => {
  const v = colorScheme.value
  if (v === 'dark') return 'dark'
  if (v === 'light') return 'light'
  return 'auto'
})

function setMode(mode: 'light' | 'dark' | 'auto') {
  colorScheme.value = mode
}

const modeOptions = computed(() => [
  {
    value: 'auto' as const,
    icon: Monitor,
    label: t('onboarding.theme.modes.auto'),
  },
  {
    value: 'light' as const,
    icon: Sun,
    label: t('onboarding.theme.modes.light'),
  },
  {
    value: 'dark' as const,
    icon: Moon,
    label: t('onboarding.theme.modes.dark'),
  },
])

// Persist language and unit preferences to backend
watch([locale, unitSystem], ([newLocale, newUnitSystem]) => {
  if (!authStore.me) return
  updatePreferences({
    language: newLocale as Locale,
    unitSystem: newUnitSystem as UnitSystem,
  }).catch(() => {})
})

const validation = inject(validateKey)

onMounted(() => {
  validation?.register(() => true)
})
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="text-center space-y-1">
      <h2 class="text-2xl font-semibold">
        {{ t('onboarding.theme.title') }}
      </h2>
      <p class="text-sm text-muted-foreground">
        {{ t('onboarding.theme.description') }}
      </p>
    </div>

    <!-- Language & Units -->
    <div class="grid grid-cols-2 gap-4">
      <div class="flex flex-col gap-2">
        <p class="text-sm font-medium">
          {{ t('onboarding.theme.languageLabel') }}
        </p>
        <Select v-model="locale">
          <SelectTrigger class="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="lang in languageOptions"
              :key="lang.value.toString()"
              :value="lang.value.toString()"
            >
              {{ lang.name }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div class="flex flex-col gap-2">
        <p class="text-sm font-medium">
          {{ t('onboarding.theme.unitsLabel') }}
        </p>
        <Select v-model="unitSystem">
          <SelectTrigger class="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem :value="UnitSystem.METRIC">
                {{ t('settings.behavior.units.metric') }}
              </SelectItem>
              <SelectItem :value="UnitSystem.IMPERIAL">
                {{ t('settings.behavior.units.imperial') }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    </div>

    <!-- Accent color -->
    <div>
      <p class="text-sm font-medium mb-3">
        {{ t('onboarding.theme.colorLabel') }}
      </p>
      <div class="flex flex-wrap gap-2 justify-center">
        <button
          v-for="color in allColors"
          :key="color"
          class="size-8 rounded-full transition-all duration-150 flex items-center justify-center cursor-pointer"
          :class="[
            accentColor === color
              ? 'ring-2 ring-offset-2 ring-offset-background ring-primary scale-110'
              : 'hover:scale-110',
          ]"
          :style="{ backgroundColor: palette[color as PaletteColor]?.[500] }"
          :title="t(`settings.appearance.appTheme.color.values.${color}`)"
          @click="setAccentColor(color)"
        >
          <Check
            v-if="accentColor === color"
            class="size-3.5 text-white drop-shadow-sm"
          />
        </button>
      </div>
    </div>

    <!-- Display mode -->
    <div>
      <p class="text-sm font-medium mb-3">
        {{ t('onboarding.theme.modeLabel') }}
      </p>
      <div class="grid grid-cols-3 gap-3">
        <button
          v-for="option in modeOptions"
          :key="option.value"
          class="flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors cursor-pointer"
          :class="[
            currentMode === option.value
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-primary/40',
          ]"
          @click="setMode(option.value)"
        >
          <component :is="option.icon" class="size-5" />
          <span class="text-sm font-medium">{{ option.label }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
