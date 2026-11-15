<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { SettingsItem, SettingsSection } from '@/components/settings'
import { useAskStore } from '@/stores/ask.store'
import { useAskService } from '@/services/ask/ask.service'
import { formatResetDay } from '@/lib/ask/ask-quota'

const { t, locale } = useI18n()
const askStore = useAskStore()
const askService = useAskService()

const usage = computed(() => {
  const access = askStore.access
  if (!access) return null
  if (access.allowed) {
    return access.keySource === 'system' ? access.quota : null
  }
  return access.reason === 'quota-exceeded'
    ? { used: access.limit, limit: access.limit, resetsAt: access.resetsAt }
    : null
})

onMounted(() => askService.loadAccess({ fresh: true }).catch(() => null))
</script>

<template>
  <SettingsSection v-if="usage" id="ask" :title="t('ask.title')">
    <SettingsItem
      :title="t('ask.usage.questions')"
      :description="t('ask.usage.resets', { date: formatResetDay(usage.resetsAt, locale) })"
    >
      <span class="text-sm font-medium tabular-nums">
        {{ t('ask.usage.count', { used: usage.used, limit: usage.limit }) }}
      </span>
    </SettingsItem>
  </SettingsSection>
</template>
