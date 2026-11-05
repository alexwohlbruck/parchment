<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { CheckIcon, PlayIcon, Volume2Icon } from 'lucide-vue-next'
import ResponsiveDialog from '@/components/responsive/ResponsiveDialog.vue'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useNavigationPreferencesStore } from '@/stores/preferences/navigation-preferences.store'
import { useSpeechCatalog } from '@/composables/speech/useSpeechCatalog'
import { i18n, storedLocale, type Locale } from '@/lib/i18n'
import { capitalize } from '@/lib/string'
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
const FILTER_TRIGGER = 'h-8 w-auto gap-1.5 text-xs'

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

let hoverTimer: ReturnType<typeof setTimeout> | undefined

const regions = computed(() => voiceRegions(voices.value, language.value))
const genders = computed(() => voiceGenders(voices.value, language.value))

watch(open, isOpen => {
  if (!isOpen) return clearTimeout(hoverTimer)
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

const regionName = (code: string) => displayNames('region').of(code) ?? code
const languageName = (locale: string) => capitalize(displayNames('language').of(baseLanguage(locale)) ?? locale, uiLocale.value)

function caption(voice: SpeechVoice) {
  const code = voiceRegion(voice)
  return [voice.gender && t(`guidance.settings.voice.genders.${voice.gender}`), code && regionName(code)]
    .filter(Boolean)
    .join(' · ')
}

const previewing = ref<string | null>(null)

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
    content-class="sm:max-w-md"
    fit-content
    modal
    :z-index-offset="10"
  >
    <template #content>
      <div class="flex flex-col gap-3">
        <div class="flex flex-wrap gap-1.5">
          <Select v-if="locales.length > 1" v-model="targetLocale">
            <SelectTrigger :class="FILTER_TRIGGER"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="locale in locales" :key="locale" :value="locale">
                {{ languageName(locale) }}
              </SelectItem>
            </SelectContent>
          </Select>

          <Select v-if="regions.length > 1" v-model="region">
            <SelectTrigger :class="FILTER_TRIGGER"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem :value="ALL">{{ t('guidance.settings.voice.allRegions') }}</SelectItem>
              <SelectItem v-for="code in regions" :key="code" :value="code">{{ regionName(code) }}</SelectItem>
            </SelectContent>
          </Select>

          <Select v-if="genders.length > 1" v-model="gender">
            <SelectTrigger :class="FILTER_TRIGGER"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem :value="ALL">{{ t('guidance.settings.voice.anyGender') }}</SelectItem>
              <SelectItem v-for="value in genders" :key="value" :value="value">
                {{ t(`guidance.settings.voice.genders.${value}`) }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div
          class="-mx-2 max-h-[55dvh] overflow-y-auto overscroll-contain sm:max-h-96"
          role="radiogroup"
          :aria-label="t('guidance.settings.speechVoice')"
        >
          <div
            v-for="option in options"
            :key="option.id || 'automatic'"
            class="flex items-center gap-1 rounded-md pr-1 hover:bg-muted/60"
            @pointerenter="hover(option.id, $event)"
            @pointerleave="leave"
          >
            <button
              type="button"
              role="radio"
              :aria-checked="selected === option.id"
              class="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-1.5 text-left focus-visible:bg-muted/60 focus-visible:outline-none"
              @click="select(option.id)"
            >
              <CheckIcon class="size-4 shrink-0" :class="selected === option.id ? 'text-primary' : 'invisible'" />
              <span class="flex min-w-0 flex-col">
                <span class="truncate text-sm font-medium">{{ option.name }}</span>
                <span v-if="option.caption" class="truncate text-xs text-muted-foreground">{{ option.caption }}</span>
              </span>
            </button>
            <Button
              variant="ghost"
              size="icon-sm"
              class="shrink-0 text-muted-foreground"
              :class="previewing === option.id && 'text-primary'"
              :title="t('guidance.settings.speechPreview')"
              @click="preview(option.id)"
            >
              <Volume2Icon v-if="previewing === option.id" class="size-4" />
              <PlayIcon v-else class="size-4" />
            </Button>
          </div>
          <p v-if="!shown.length" class="px-2 py-3 text-sm text-muted-foreground">
            {{ t('guidance.settings.voice.noMatches') }}
          </p>
        </div>
      </div>
    </template>
  </ResponsiveDialog>
</template>
