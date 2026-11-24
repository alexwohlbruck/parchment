<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useStorage } from '@vueuse/core'
import { useIdentityStore } from '@/stores/identity.store'
import { toast } from '@/lib/toast'
import RecoveryKeyDialog from './RecoveryKeyDialog.vue'

const { t } = useI18n()
const { identity, isSetupComplete, isStale, hasSavedRecoveryWords } = storeToRefs(useIdentityStore())

/** The signing key this device last prompted for, so each set of words is announced once. */
const promptedFor = useStorage('parchment:recovery-words-prompted', '')
const open = ref(false)

watch(
  () =>
    isSetupComplete.value && !isStale.value && hasSavedRecoveryWords.value === false
      ? identity.value?.signingKey
      : null,
  signingKey => {
    if (!signingKey || promptedFor.value === signingKey) return
    promptedFor.value = signingKey
    toast(t('settings.identity.recoveryKey.prompt.title'), {
      description: t('settings.identity.recoveryKey.prompt.description'),
      action: {
        label: t('settings.identity.recoveryKey.prompt.action'),
        onClick: () => {
          open.value = true
        },
      },
      duration: 30000,
    })
  },
  { immediate: true },
)
</script>

<template>
  <RecoveryKeyDialog v-model:open="open" mode="view" />
</template>
