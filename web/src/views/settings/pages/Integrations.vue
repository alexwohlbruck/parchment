<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import IntegrationCatalog from '@/components/integration/IntegrationCatalog.vue'
import { IntegrationScope } from '@/types/integrations.types'

const { t } = useI18n()
</script>

<template>
  <IntegrationCatalog
    :scope="IntegrationScope.USER"
    section-id="integrations"
    :title="t('settings.integrations.title')"
    :description="t('settings.integrations.description')"
  />
</template>
