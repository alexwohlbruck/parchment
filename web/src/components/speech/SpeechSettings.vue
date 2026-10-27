<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { Volume2Icon } from 'lucide-vue-next'
import { useSpeechStore } from '@/stores/speech.store'
import { useSpeechCatalog } from '@/composables/speech/useSpeechCatalog'
import { storedLocale, i18n } from '@/lib/i18n'
import { speak, releaseSpeech, unlockSpeech } from '@/services/speech/speech.service'
import { SettingsItem } from '@/components/settings'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'

const { preferences } = storeToRefs(useSpeechStore())
const { catalog } = useSpeechCatalog()
const voices = computed(() => catalog.value?.voices.filter(voice => voice.language.split('-')[0] === storedLocale.value.split('-')[0]) ?? [])
const voice = computed({
  get: () => preferences.value.voices[storedLocale.value] || 'automatic',
  set: (value: string) => { preferences.value.voices = { ...preferences.value.voices, [storedLocale.value]: value === 'automatic' ? '' : value } },
})
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
    <Select v-if="voices.length" v-model="voice">
      <SelectTrigger class="w-fit max-w-48"><SelectValue /></SelectTrigger>
      <SelectContent><SelectGroup>
        <SelectItem value="automatic">{{ $t('guidance.settings.speechAutomatic') }}</SelectItem>
        <SelectItem v-for="item in voices" :key="item.id" :value="item.id">{{ item.name }} · {{ item.language }}</SelectItem>
      </SelectGroup></SelectContent>
    </Select>
  </SettingsItem>
  <SettingsItem :title="$t('guidance.settings.speechRate')" :description="$t('guidance.settings.speechRateDescription')">
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
