<script setup lang="ts">
import { computed, inject, onMounted } from 'vue'
import { useStorage } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useThemeStore, allColors } from '@/stores/theme.store'
import { colors } from '@/lib/registry/colors'
import { Sun, Moon, Monitor, Check } from 'lucide-vue-next'
import { validateKey } from './types'

const { t } = useI18n()
const themeStore = useThemeStore()
const { accentColor } = storeToRefs(themeStore)
const { setAccentColor } = themeStore

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
  { value: 'auto' as const, icon: Monitor, label: t('onboarding.theme.modes.auto') },
  { value: 'light' as const, icon: Sun, label: t('onboarding.theme.modes.light') },
  { value: 'dark' as const, icon: Moon, label: t('onboarding.theme.modes.dark') },
])

const validation = inject(validateKey)

onMounted(() => {
  validation?.register(() => true)
})
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="text-center space-y-1">
      <h2 class="text-xl font-semibold">
        {{ t('onboarding.theme.title') }}
      </h2>
      <p class="text-sm text-muted-foreground">
        {{ t('onboarding.theme.description') }}
      </p>
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
          :style="{ backgroundColor: colors[color][5].rgb }"
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
