<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useIntegrationsStore } from '@/stores/integrations.store'
import type { IntegrationScope } from '@/types/integrations.types'

// Mirrors the degraded status dot on IntegrationTile; renders nothing while
// every integration is healthy, so call sites can include it unconditionally.
const props = defineProps<{ scope?: IntegrationScope }>()

const integrationsStore = useIntegrationsStore()
const { t } = useI18n()

const degraded = computed(() =>
  props.scope
    ? integrationsStore.hasDegradedIntegrationsIn(props.scope)
    : integrationsStore.hasDegradedIntegrations,
)
</script>

<template>
  <span
    v-if="degraded"
    class="block size-2 rounded-full border-[1.75px] bg-[#FDBA74] border-[#F97316]"
    :aria-label="t('settings.integrations.degraded.label')"
  />
</template>
