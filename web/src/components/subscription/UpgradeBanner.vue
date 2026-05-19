<script setup lang="ts">
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Crown } from 'lucide-vue-next'
import { useSubscriptionService } from '@/services/subscription.service'

defineProps<{
  feature: string
  description?: string
}>()

const subscriptionService = useSubscriptionService()
</script>

<template>
  <Card
    v-if="subscriptionService.billingEnabled"
    class="flex items-center gap-3 p-4 border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30"
  >
    <div
      class="flex items-center justify-center w-9 h-9 rounded-lg bg-amber-100 dark:bg-amber-900/50 shrink-0"
    >
      <Crown class="w-5 h-5 text-amber-600 dark:text-amber-400" />
    </div>
    <div class="flex-1 min-w-0">
      <p class="text-sm font-medium">Premium feature</p>
      <p v-if="description" class="text-xs text-muted-foreground">
        {{ description }}
      </p>
    </div>
    <Button
      size="sm"
      variant="default"
      :loading="subscriptionService.loading.value"
      @click="subscriptionService.startCheckout()"
    >
      Upgrade
    </Button>
  </Card>
</template>
