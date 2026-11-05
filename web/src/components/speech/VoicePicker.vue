<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { CheckIcon, Volume2Icon } from 'lucide-vue-next'
import ResponsiveDialog from '@/components/responsive/ResponsiveDialog.vue'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useNavigationPreferencesStore } from '@/stores/preferences/navigation-preferences.store'
import { useSpeechCatalog } from '@/composables/speech/useSpeechCatalog'
import { i18n, storedLocale, type Locale } from '@/lib/i18n'
import { speak, unlockSpeech } from '@/services/speech/speech.service'
import {
  baseLanguage,
  filterVoices,
  voiceGenders,
  voiceRegion,
  voiceRegions,
  type VoiceGender,
} from '@/lib/speech/voice-filters'
import type { SpeechVoice } from '@server/types/speech.types'

const open = defineModel<boolean>('open', { default: false })

const APP_LOCALES: Locale[] = ['en-US', 'es-ES']
const AUTOMATIC = ''
const ALL = 'all'
const HOVER_PREVIEW_MS = 350

const { t, locale: uiLocale } = useI18n()
const { speech: preferences } = storeToRefs(useNavigationPreferencesStore())
const { catalog } = useSpeechCatalog()
const voices = computed(() => catalog.value?.voices ?? [])

const locales = computed(() =>
  APP_LOCALES.filter(locale => voices.value.some(v => baseLanguage(v.language) === baseLanguage(locale))),
)
const targetLocale = ref<Locale>(storedLocale.value)
const language = computed(() => baseLanguage(targetLocale.value))
const region = ref<string>(ALL)
const gender = ref<string>(ALL)

const regions = computed(() => voiceRegions(voices.value, language.value))
const genders = computed(() => voiceGenders(voices.value, language.value))

watch(open, isOpen => {
  if (!isOpen) return
  targetLocale.value = storedLocale.value
  region.value = ALL
  gender.value = ALL
})
watch(targetLocale, () => (region.value = ALL))

const shown = computed(() =>
  filterVoices(voices.value, {
    language: language.value,
    region: region.value === ALL ? null : region.value,
    gender: gender.value === ALL ? null : (gender.value as VoiceGender),
  }),
)

const selected = computed(() => preferences.value.voices[targetLocale.value] || AUTOMATIC)

function select(id: string) {
  preferences.value.voices = { ...preferences.value.voices, [targetLocale.value]: id }
  preview(id)
}

const displayNames = (type: 'region' | 'language') =>
  new Intl.DisplayNames([uiLocale.value], { type, fallback: 'code' })

function capitalize(text: string) {
  return text.charAt(0).toLocaleUpperCase(uiLocale.value) + text.slice(1)
}

const regionName = (code: string) => displayNames('region').of(code) ?? code
const languageName = (locale: string) => capitalize(displayNames('language').of(baseLanguage(locale)) ?? locale)

function caption(voice: SpeechVoice) {
  const code = voiceRegion(voice)
  return [voice.gender && t(`guidance.settings.voice.genders.${voice.gender}`), code && regionName(code)]
    .filter(Boolean)
    .join(' · ')
}

const previewing = ref<string | null>(null)
let hoverTimer: ReturnType<typeof setTimeout> | undefined

function preview(id: string) {
  clearTimeout(hoverTimer)
  unlockSpeech()
  previewing.value = id
  const sample = (i18n.global as any).t('guidance.settings.speechSample', {}, { locale: targetLocale.value })
  speak(sample, { lang: targetLocale.value, voice: id || undefined, rate: preferences.value.rate, urgent: true })
}

function hover(id: string, event: PointerEvent) {
  if (event.pointerType !== 'mouse') return
  clearTimeout(hoverTimer)
  hoverTimer = setTimeout(() => preview(id), HOVER_PREVIEW_MS)
}

function leave() {
  clearTimeout(hoverTimer)
}

onBeforeUnmount(() => clearTimeout(hoverTimer))

const options = computed(() => [
  { id: AUTOMATIC, name: t('guidance.settings.speechAutomatic'), caption: t('guidance.settings.voice.automaticCaption') },
  ...shown.value.map(voice => ({ id: voice.id, name: voice.name, caption: caption(voice) })),
])
</script>

<template>
  <ResponsiveDialog
    v-model:open="open"
    :title="t('guidance.settings.speechVoice')"
    :description="t('guidance.settings.voice.pickerDescription')"
  >
    <template #content>
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-2">
          <ToggleGroup
            v-if="locales.length > 1"
            :model-value="targetLocale"
            type="single"
            variant="outline"
            size="sm"
            class="flex-wrap justify-start"
            @update:model-value="value => value && (targetLocale = value as Locale)"
          >
            <ToggleGroupItem v-for="locale in locales" :key="locale" :value="locale">
              {{ languageName(locale) }}
            </ToggleGroupItem>
          </ToggleGroup>

          <ToggleGroup
            v-if="regions.length > 1"
            :model-value="region"
            type="single"
            variant="outline"
            size="sm"
            class="flex-wrap justify-start"
            @update:model-value="value => value && (region = value as string)"
          >
            <ToggleGroupItem :value="ALL">{{ t('guidance.settings.voice.allRegions') }}</ToggleGroupItem>
            <ToggleGroupItem v-for="code in regions" :key="code" :value="code">
              {{ regionName(code) }}
            </ToggleGroupItem>
          </ToggleGroup>

          <ToggleGroup
            v-if="genders.length > 1"
            :model-value="gender"
            type="single"
            variant="outline"
            size="sm"
            class="flex-wrap justify-start"
            @update:model-value="value => value && (gender = value as string)"
          >
            <ToggleGroupItem :value="ALL">{{ t('guidance.settings.voice.anyGender') }}</ToggleGroupItem>
            <ToggleGroupItem v-for="value in genders" :key="value" :value="value">
              {{ t(`guidance.settings.voice.genders.${value}`) }}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div class="-mx-2 max-h-[50vh] overflow-y-auto" role="radiogroup" :aria-label="t('guidance.settings.speechVoice')">
          <button
            v-for="option in options"
            :key="option.id || 'automatic'"
            type="button"
            role="radio"
            :aria-checked="selected === option.id"
            class="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
            @click="select(option.id)"
            @pointerenter="hover(option.id, $event)"
            @pointerleave="leave"
          >
            <CheckIcon class="size-4 shrink-0" :class="selected === option.id ? 'text-primary' : 'invisible'" />
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate text-sm font-medium">{{ option.name }}</span>
              <span v-if="option.caption" class="truncate text-xs text-muted-foreground">{{ option.caption }}</span>
            </span>
            <Volume2Icon
              class="size-4 shrink-0 text-muted-foreground"
              :class="previewing === option.id ? 'opacity-100' : 'opacity-0'"
            />
          </button>
          <p v-if="!shown.length" class="px-2 py-3 text-sm text-muted-foreground">
            {{ t('guidance.settings.voice.noMatches') }}
          </p>
        </div>
      </div>
    </template>
  </ResponsiveDialog>
</template>
