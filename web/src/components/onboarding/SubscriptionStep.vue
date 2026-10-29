<script setup lang="ts">
import OnboardingHeader from './OnboardingHeader.vue'
import { inject, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { validateKey } from './types'
import PlanSelector from '@/components/subscription/PlanSelector.vue'

const { t } = useI18n()

const validation = inject(validateKey)

onMounted(() => {
  validation?.register(() => true)
})

const checkoutSuccessUrl = `${window.location.origin}${window.location.pathname}?checkout=success`
</script>

<template>
  <div class="flex flex-col gap-6">
    <OnboardingHeader
      :title="t('onboarding.subscription.title')"
      :description="t('onboarding.subscription.description')"
    />

    <PlanSelector :checkout-success-url="checkoutSuccessUrl" />
  </div>
</template>
