<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import PasskeyOfferContent from '@/components/friends/PasskeyOfferContent.vue'

const { t } = useI18n()

const emit = defineEmits<{
  complete: []
  skip: []
}>()
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="text-center space-y-1">
      <h2 class="text-xl font-semibold">
        {{ t('onboarding.passkey.title') }}
      </h2>
      <p class="text-sm text-muted-foreground">
        {{ t('onboarding.passkey.description') }}
      </p>
    </div>

    <PasskeyOfferContent
      @complete="emit('complete')"
      @skip="emit('skip')"
    />
  </div>
</template>
