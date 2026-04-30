<script setup lang="ts">
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Settings } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import { IntegrationCapabilityId } from '@/types/integrations.types'
import { useI18n } from 'vue-i18n'

const router = useRouter()
const { t } = useI18n()

function navigateToIntegrations() {
  router.push({
    name: AppRoute.INTEGRATIONS,
    query: { capability: IntegrationCapabilityId.LOCATION_HISTORY },
  })
}
</script>

<template>
  <div class="flex items-center justify-center h-full w-full">
    <Card class="max-w-md mx-4">
      <CardHeader class="text-center">
        <CardTitle class="text-xl">{{ t('timeline.noIntegration.title') }}</CardTitle>
        <CardDescription class="text-center">
          {{ t('timeline.noIntegration.description') }}
        </CardDescription>
      </CardHeader>
      <CardContent class="text-center space-y-4">
        <p class="text-sm text-muted-foreground">
          {{ t('timeline.noIntegration.details') }}
        </p>
        <Button @click="navigateToIntegrations" class="w-full">
          <Settings class="h-4 w-4 mr-2" />
          {{ t('timeline.noIntegration.configure') }}
        </Button>
      </CardContent>
    </Card>
  </div>
</template>
