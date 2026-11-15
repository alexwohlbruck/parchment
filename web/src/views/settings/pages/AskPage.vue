<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import {
  GlobeIcon,
  HistoryIcon,
  KeyRoundIcon,
  LocateFixedIcon,
  MessageCircleQuestionIcon,
  CornerDownLeftIcon,
  TimerIcon,
  Trash2Icon,
} from 'lucide-vue-next'
import { AppRoute } from '@/router'
import { ASK_HISTORY_DAYS } from '@server/types/ask-preferences.types'
import { SettingsSection, SettingsItem } from '@/components/settings'
import AskUsageSection from '@/components/ask/AskUsageSection.vue'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAskStore } from '@/stores/ask.store'
import { useAskPreferencesStore } from '@/stores/preferences/ask-preferences.store'
import { useAskSettingsService } from '@/services/ask/ask-settings.service'
import { useAskHistoryService } from '@/services/ask/ask-history.service'
import { useAppService } from '@/services/app.service'
import type { AskHistoryDays } from '@/types/ask.types'

const { t } = useI18n()
const router = useRouter()
const askStore = useAskStore()
const askPreferences = useAskPreferencesStore()
const askSettings = useAskSettingsService()
const askHistory = useAskHistoryService()
const appService = useAppService()

const preferences = computed(() => askPreferences.preferences)

const keepDays = computed({
  get: () => String(preferences.value.keepDays),
  set: (value: string) => askSettings.update({ keepDays: Number(value) as AskHistoryDays }),
})

async function clearHistory() {
  const confirmed = await appService.confirm({
    title: t('settings.ask.history.clear.confirmTitle'),
    description: t('settings.ask.history.clear.confirmDescription'),
    continueText: t('settings.ask.history.clear.action'),
    destructive: true,
  })
  if (confirmed) await askHistory.clear()
}

onMounted(() => askHistory.load())
</script>

<template>
  <div class="flex flex-col gap-4">
    <SettingsSection id="ask" :title="t('settings.ask.title')">
      <SettingsItem
        :title="t('settings.ask.enabled.title')"
        :description="t('settings.ask.enabled.description')"
        :icon="MessageCircleQuestionIcon"
      >
        <Switch
          :model-value="preferences.enabled"
          @update:model-value="askSettings.update({ enabled: $event })"
        />
      </SettingsItem>
      <SettingsItem
        v-if="preferences.enabled"
        :title="t('settings.ask.suggest.title')"
        :description="t('settings.ask.suggest.description')"
        :icon="CornerDownLeftIcon"
      >
        <Switch
          :model-value="preferences.suggest"
          @update:model-value="askSettings.update({ suggest: $event })"
        />
      </SettingsItem>
    </SettingsSection>

    <template v-if="preferences.enabled">
      <SettingsSection id="ask-data" :title="t('settings.ask.data.title')">
        <SettingsItem
          :title="t('settings.ask.shareLocation.title')"
          :description="t('settings.ask.shareLocation.description')"
          :icon="LocateFixedIcon"
        >
          <Switch
            :model-value="preferences.shareLocation"
            @update:model-value="askSettings.update({ shareLocation: $event })"
          />
        </SettingsItem>
        <SettingsItem
          :title="t('settings.ask.webSearch.title')"
          :description="t('settings.ask.webSearch.description')"
          :icon="GlobeIcon"
        >
          <Switch
            :model-value="preferences.webSearch"
            @update:model-value="askSettings.update({ webSearch: $event })"
          />
        </SettingsItem>
      </SettingsSection>

      <SettingsSection id="ask-history" :title="t('settings.ask.history.title')">
        <SettingsItem
          :title="t('settings.ask.history.save.title')"
          :description="t('settings.ask.history.save.description')"
          :icon="HistoryIcon"
        >
          <Switch
            :model-value="preferences.saveHistory"
            @update:model-value="askSettings.update({ saveHistory: $event })"
          />
        </SettingsItem>
        <SettingsItem
          v-if="preferences.saveHistory"
          :title="t('settings.ask.history.keep.title')"
          :description="t('settings.ask.history.keep.description')"
          :icon="TimerIcon"
        >
          <Select v-model="keepDays">
            <SelectTrigger class="w-fit">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem v-for="days in ASK_HISTORY_DAYS" :key="days" :value="String(days)">
                  {{ t(`settings.ask.history.keep.options.${days}`) }}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </SettingsItem>
        <SettingsItem
          :title="t('settings.ask.history.clear.title')"
          :description="t('settings.ask.history.clear.description', { count: askStore.threads.length }, askStore.threads.length)"
          :icon="Trash2Icon"
        >
          <div class="flex items-center gap-2">
            <Button variant="outline" size="sm" @click="router.push({ name: AppRoute.ASK })">
              {{ t('settings.ask.history.see') }}
            </Button>
            <Button
              variant="outline"
              size="sm"
              class="text-destructive"
              :disabled="!askStore.threads.length"
              @click="clearHistory"
            >
              {{ t('settings.ask.history.clear.action') }}
            </Button>
          </div>
        </SettingsItem>
      </SettingsSection>

      <SettingsSection id="ask-key" :title="t('settings.ask.key.title')">
        <SettingsItem
          :title="t('settings.ask.key.item')"
          :description="t('settings.ask.key.description')"
          :icon="KeyRoundIcon"
        >
          <Button variant="outline" size="sm" @click="router.push({ name: AppRoute.INTEGRATIONS })">
            {{ t('settings.ask.key.action') }}
          </Button>
        </SettingsItem>
      </SettingsSection>

      <AskUsageSection />
    </template>
  </div>
</template>
