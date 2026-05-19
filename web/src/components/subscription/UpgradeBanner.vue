<script setup lang="ts">
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Sparkles } from 'lucide-vue-next'
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
    class="flex items-center gap-3 p-4 border-violet-200 dark:border-violet-800/60 bg-violet-50/50 dark:bg-violet-950/20"
  >
    <div
      class="flex items-center justify-center w-9 h-9 rounded-lg bg-violet-100 dark:bg-violet-900/30 shrink-0"
    >
      <Sparkles class="w-5 h-5 text-violet-600 dark:text-violet-400" />
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
