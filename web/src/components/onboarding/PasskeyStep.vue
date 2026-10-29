<script setup lang="ts">
import { Fingerprint } from 'lucide-vue-next'
import OnboardingHeader from './OnboardingHeader.vue'
import { inject, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import PasskeyOfferContent from '@/components/identity/PasskeyOfferContent.vue'
import { validateKey } from './types'

const { t } = useI18n()

const emit = defineEmits<{
  complete: []
}>()

const validation = inject(validateKey)

onMounted(() => {
  validation?.register(() => true)
})
</script>

<template>
  <div class="flex flex-col gap-6">
    <OnboardingHeader
      :title="t('onboarding.passkey.title')"
      :description="t('onboarding.passkey.description')"
      :icon="Fingerprint"
    />

    <PasskeyOfferContent hide-skip hide-intro @complete="emit('complete')" />
  </div>
</template>
