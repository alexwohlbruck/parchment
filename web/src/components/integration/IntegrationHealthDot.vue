<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useIntegrationsStore } from '@/stores/integrations.store'

// Mirrors the degraded status dot on IntegrationTile; renders nothing while
// every integration is healthy, so call sites can include it unconditionally.
const integrationsStore = useIntegrationsStore()
const { t } = useI18n()
</script>

<template>
  <span
    v-if="integrationsStore.hasDegradedIntegrations"
    class="block size-2 rounded-full border-[1.75px] bg-[#FDBA74] border-[#F97316]"
    :aria-label="t('settings.integrations.degraded.label')"
  />
</template>
