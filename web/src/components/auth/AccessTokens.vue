<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import dayjs from 'dayjs'
import localizedFormat from 'dayjs/plugin/localizedFormat'
import { KeyRoundIcon, PlugIcon, PlusIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { SettingsSection, SettingsItem } from '@/components/settings'
import CreateAccessTokenDialog from '@/components/auth/CreateAccessTokenDialog.vue'
import { useAppService } from '@/services/app.service'
import { listAccessTokens, revokeAccessToken } from '@/services/auth/access-token.service'
import { formatTimeAgo } from '@/lib/time-format'
import { toast } from '@/lib/toast'
import type { AccessTokenSummary } from '@/types/access-token.types'

dayjs.extend(localizedFormat)

const { t } = useI18n()
const appService = useAppService()

const tokens = shallowRef<AccessTokenSummary[]>([])
const creating = ref(false)

const apps = computed(() => tokens.value.filter(token => token.kind === 'oauth'))
const personal = computed(() => tokens.value.filter(token => token.kind === 'personal'))

async function load() {
  tokens.value = await listAccessTokens()
}

onMounted(load)

function scopesText(token: AccessTokenSummary) {
  return token.scopes.map(scope => t(`settings.auth.scopes.${scope}.title`)).join(', ')
}

function usageText(token: AccessTokenSummary) {
  const used = token.lastUsedAt
    ? t('settings.auth.tokens.lastUsed', { when: formatTimeAgo(token.lastUsedAt, t) })
    : t('settings.auth.tokens.neverUsed')
  const expiry = token.expiresAt
    ? t('settings.auth.tokens.expires', { date: dayjs(token.expiresAt).format('ll') })
    : t('settings.auth.tokens.neverExpires')
  return [scopesText(token), used, expiry].join(' · ')
}

async function revoke(token: AccessTokenSummary) {
  const isApp = token.kind === 'oauth'
  const confirmed = await appService.confirm({
    title: t(isApp ? 'settings.auth.apps.disconnectTitle' : 'settings.auth.tokens.revokeTitle', { name: token.name }),
    description: t(isApp ? 'settings.auth.apps.disconnectDescription' : 'settings.auth.tokens.revokeDescription'),
    continueText: t(isApp ? 'settings.auth.apps.disconnect' : 'settings.auth.tokens.revoke'),
    destructive: true,
  })
  if (!confirmed) return
  try {
    await revokeAccessToken(token.id)
    tokens.value = tokens.value.filter(candidate => candidate.id !== token.id)
  } catch (error) {
    toast.error(t('settings.auth.tokens.revokeFailed'), { cause: error })
  }
}
</script>

<template>
  <SettingsSection v-if="apps.length" id="connected-apps" :title="t('settings.auth.apps.title')">
    <SettingsItem
      v-for="app in apps"
      :key="app.id"
      :title="app.name"
      :description="usageText(app)"
      :icon="PlugIcon"
    >
      <Button variant="outline" size="sm" class="text-destructive" @click="revoke(app)">
        {{ t('settings.auth.apps.disconnect') }}
      </Button>
    </SettingsItem>
  </SettingsSection>

  <SettingsSection
    id="access-tokens"
    :title="t('settings.auth.tokens.title')"
    :description="t('settings.auth.tokens.description')"
  >
    <template #actions>
      <Button variant="outline" size="sm" :icon="PlusIcon" @click="creating = true">
        {{ t('settings.auth.tokens.create') }}
      </Button>
    </template>

    <p v-if="!personal.length" class="text-sm text-muted-foreground">
      {{ t('settings.auth.tokens.empty') }}
    </p>
    <SettingsItem
      v-for="token in personal"
      :key="token.id"
      :title="token.name"
      :description="usageText(token)"
      :icon="KeyRoundIcon"
    >
      <Button variant="outline" size="sm" class="text-destructive" @click="revoke(token)">
        {{ t('settings.auth.tokens.revoke') }}
      </Button>
    </SettingsItem>
  </SettingsSection>

  <CreateAccessTokenDialog v-model:open="creating" @created="load" />
</template>
