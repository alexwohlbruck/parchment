<script setup lang="ts">
import { ref, inject, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useIdentityStore } from '@/stores/identity.store'
import { validateKey } from './types'
import RecoveryKeySetupContent from '@/components/friends/RecoveryKeySetupContent.vue'

const { t } = useI18n()
const identityStore = useIdentityStore()
const contentRef = ref<InstanceType<typeof RecoveryKeySetupContent>>()

const validation = inject(validateKey)

onMounted(async () => {
  await identityStore.startSetup()
  validation?.register(async () => {
    if (!contentRef.value?.hasSavedKey) return false
    return await contentRef.value.handleConfirm()
  })
})
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="text-center space-y-1">
      <h2 class="text-xl font-semibold">
        {{ t('onboarding.recoveryKey.title') }}
      </h2>
      <p class="text-sm text-muted-foreground">
        {{ t('onboarding.recoveryKey.description') }}
      </p>
    </div>

    <RecoveryKeySetupContent
      ref="contentRef"
      hide-footer
    />
  </div>
</template>
