<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { LinkIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { AppRoute } from '@/router'
import { IntegrationId } from '@/types/integrations.types'

const router = useRouter()
const { t } = useI18n()

function openIntegration() {
  router.push({
    name: AppRoute.INTEGRATIONS,
    query: { integration: IntegrationId.OPENSTREETMAP_ACCOUNT },
  })
}
</script>

<template>
  <EmptyState
    :icon="LinkIcon"
    :title="t('quickEdit.connectTitle')"
    :description="t('quickEdit.connectDescription')"
  >
    <Button size="sm" @click="openIntegration">
      {{ t('quickEdit.connectAction') }}
    </Button>
  </EmptyState>
</template>
