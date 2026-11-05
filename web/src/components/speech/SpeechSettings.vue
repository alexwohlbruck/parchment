<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { AudioLinesIcon, ChevronRightIcon, Volume2Icon } from 'lucide-vue-next'
import { useNavigationPreferencesStore } from '@/stores/preferences/navigation-preferences.store'
import { useSpeechCatalog } from '@/composables/speech/useSpeechCatalog'
import { storedLocale, i18n } from '@/lib/i18n'
import { speak, releaseSpeech, unlockSpeech } from '@/services/speech/speech.service'
import { SettingsItem } from '@/components/settings'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import VoicePicker from './VoicePicker.vue'

const { speech: preferences } = storeToRefs(useNavigationPreferencesStore())
const { catalog } = useSpeechCatalog()
const voices = computed(() => catalog.value?.voices.filter(voice => voice.language.split('-')[0] === storedLocale.value.split('-')[0]) ?? [])
const voiceName = computed(() => {
  const id = preferences.value.voices[storedLocale.value]
  return voices.value.find(voice => voice.id === id)?.name ?? (i18n.global as any).t('guidance.settings.speechAutomatic')
})
const pickerOpen = ref(false)
const rate = computed({ get: () => String(preferences.value.rate), set: (value: string) => { preferences.value.rate = Number(value) } })
const previewed = ref(false)
function preview() {
  previewed.value = true
  unlockSpeech()
  speak((i18n.global as any).t('guidance.settings.speechSample'), { lang: storedLocale.value, voice: preferences.value.voices[storedLocale.value], rate: preferences.value.rate, urgent: true })
}
onBeforeUnmount(() => { if (previewed.value) releaseSpeech() })
</script>

<template>
  <SettingsItem :title="$t('guidance.settings.speechVoice')" :description="voices.length ? $t('guidance.settings.speechVoiceDescription') : $t('guidance.settings.speechFallback')" :icon="Volume2Icon">
    <Button v-if="voices.length" variant="outline" class="max-w-48 gap-1.5" @click="unlockSpeech(); pickerOpen = true">
      <span class="truncate">{{ voiceName }}</span>
      <ChevronRightIcon class="size-4 shrink-0 opacity-50" />
    </Button>
  </SettingsItem>
  <VoicePicker v-model:open="pickerOpen" />
  <SettingsItem :title="$t('guidance.settings.speechRate')" :description="$t('guidance.settings.speechRateDescription')" :icon="AudioLinesIcon">
    <div class="flex items-center gap-2">
      <Select v-model="rate">
        <SelectTrigger class="w-fit"><SelectValue /></SelectTrigger>
        <SelectContent><SelectGroup>
          <SelectItem v-for="value in [0.75, 1, 1.15, 1.25, 1.5]" :key="value" :value="String(value)">{{ value }}×</SelectItem>
        </SelectGroup></SelectContent>
      </Select>
      <Button variant="outline" size="sm" @click="preview">{{ $t('guidance.settings.speechPreview') }}</Button>
    </div>
  </SettingsItem>
</template>
