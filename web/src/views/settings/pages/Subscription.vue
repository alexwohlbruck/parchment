<script setup lang="ts">
import { onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { SettingsSection } from '@/components/settings'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Crown, Check, ExternalLink } from 'lucide-vue-next'
import { useSubscriptionService } from '@/services/subscription.service'
import { toast } from 'vue-sonner'

const route = useRoute()
const subscriptionService = useSubscriptionService()

const premiumFeatures = [
  'Enhanced third-party business data',
  'Advanced map layers (3D terrain, weather, and more)',
  'Unlimited custom maps and layer configurations',
  'Premium navigation and routing preferences',
  'Advanced real-time location sharing',
  'Auto-refresh search results',
]

onMounted(async () => {
  if (route.query.checkout === 'success') {
    const status = await subscriptionService.refreshStatus()
    if (status.isPremium) {
      toast.success('Welcome to Premium!', {
        description: 'Your subscription is now active.',
      })
    } else {
      toast.info('Processing your subscription...', {
        description: 'It may take a moment to activate. Refresh to check.',
      })
    }
  }
})
</script>

<template>
  <div v-if="subscriptionService.billingEnabled.value" class="flex flex-col gap-4">
    <SettingsSection id="plan" title="Plan">
      <div class="flex items-center gap-3">
        <div
          class="flex items-center justify-center w-10 h-10 rounded-lg"
          :class="
            subscriptionService.isPremium.value
              ? 'bg-amber-100 dark:bg-amber-900/50'
              : 'bg-muted'
          "
        >
          <Crown
            class="w-5 h-5"
            :class="
              subscriptionService.isPremium.value
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-muted-foreground'
            "
          />
        </div>
        <div class="flex-1">
          <div class="flex items-center gap-2">
            <span class="font-medium">
              {{ subscriptionService.isPremium.value ? 'Premium' : 'Free' }}
            </span>
            <Badge
              v-if="subscriptionService.isPremium.value"
              variant="secondary"
              class="bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300"
            >
              Active
            </Badge>
          </div>
          <p class="text-sm text-muted-foreground">
            {{
              subscriptionService.isPremium.value
                ? 'You have access to all premium features.'
                : 'Upgrade to unlock all features.'
            }}
          </p>
        </div>
      </div>

      <div class="flex gap-2 pt-2">
        <Button
          v-if="!subscriptionService.isPremium.value"
          :loading="subscriptionService.loading.value"
          @click="subscriptionService.startCheckout()"
        >
          <Crown class="w-4 h-4 mr-2" />
          Upgrade to Premium
        </Button>
        <Button
          v-if="subscriptionService.hasSubscription.value"
          variant="outline"
          @click="subscriptionService.openPortal()"
        >
          <ExternalLink class="w-4 h-4 mr-2" />
          Manage Subscription
        </Button>
      </div>
    </SettingsSection>

    <SettingsSection
      v-if="!subscriptionService.isPremium.value"
      id="features"
      title="Premium features"
    >
      <ul class="flex flex-col gap-2">
        <li
          v-for="feature in premiumFeatures"
          :key="feature"
          class="flex items-center gap-2 text-sm"
        >
          <Check class="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <span>{{ feature }}</span>
        </li>
      </ul>
    </SettingsSection>
  </div>
</template>
