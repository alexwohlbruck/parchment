<script setup lang="ts">
import { inject, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useIdentityStore } from '@/stores/identity.store'
import { validateKey } from './types'
import RecoveryKeySetupContent from '@/components/friends/RecoveryKeySetupContent.vue'

const { t } = useI18n()
const identityStore = useIdentityStore()

const emit = defineEmits<{
  confirm: []
}>()

const validation = inject(validateKey)

onMounted(async () => {
  await identityStore.startSetup()
  validation?.register(() => true)
})

function handleConfirm() {
  emit('confirm')
}
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
      @confirm="handleConfirm"
      @cancel="() => {}"
    />
  </div>
</template>
