<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { SettingsSection } from '@/components/settings'
import { useAskStore } from '@/stores/ask.store'
import { useAskService } from '@/services/ask/ask.service'
import { formatResetDay } from '@/lib/ask/ask-quota'

const NEARLY_USED = 0.9

const { t, locale, n } = useI18n()
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

const share = computed(() => (usage.value ? Math.min(1, usage.value.used / usage.value.limit) : 0))

onMounted(() => askService.loadAccess({ fresh: true }).catch(() => null))
</script>

<template>
  <SettingsSection v-if="usage" id="ask-usage" :title="t('settings.ask.usage.title')">
    <div class="flex flex-col gap-2 py-1">
      <div class="flex items-baseline justify-between gap-2">
        <span class="text-sm">
          <span class="text-base font-semibold tabular-nums">{{ n(usage.used) }}</span>
          <span class="text-muted-foreground"> {{ t('ask.usage.of', { limit: n(usage.limit) }) }}</span>
        </span>
        <span class="text-xs text-muted-foreground">
          {{ t('ask.usage.resets', { date: formatResetDay(usage.resetsAt, locale) }) }}
        </span>
      </div>
      <div
        class="h-1.5 overflow-hidden rounded-full bg-muted"
        role="meter"
        :aria-valuenow="usage.used"
        aria-valuemin="0"
        :aria-valuemax="usage.limit"
        :aria-label="t('ask.usage.questions')"
      >
        <div
          class="h-full rounded-full transition-[width] duration-500"
          :class="share >= NEARLY_USED ? 'bg-destructive' : 'bg-primary'"
          :style="{ width: `${share * 100}%` }"
        />
      </div>
    </div>
  </SettingsSection>
</template>
