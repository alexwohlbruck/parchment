<script setup lang="ts">
import { inject, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import PasskeyOfferContent from '@/components/friends/PasskeyOfferContent.vue'
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
    <div class="text-center space-y-1">
      <h2 class="text-2xl font-semibold">
        {{ t('onboarding.passkey.title') }}
      </h2>
      <p class="text-sm text-muted-foreground">
        {{ t('onboarding.passkey.description') }}
      </p>
    </div>

    <PasskeyOfferContent hide-skip @complete="emit('complete')" />
  </div>
</template>
