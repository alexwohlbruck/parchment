<script setup lang="ts">
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
    <div class="text-center space-y-1">
      <h2 class="text-2xl font-semibold">
        {{ t('onboarding.subscription.title') }}
      </h2>
      <p class="text-sm text-muted-foreground">
        {{ t('onboarding.subscription.description') }}
      </p>
    </div>

    <PlanSelector :checkout-success-url="checkoutSuccessUrl" />
  </div>
</template>
