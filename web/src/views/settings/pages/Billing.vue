<script setup lang="ts">
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { SettingsSection } from '@/components/settings'
import { Button } from '@/components/ui/button'
import { ExternalLink, ArrowRight, Check } from 'lucide-vue-next'
import { useSubscriptionService } from '@/services/subscription.service'
import { toast } from 'vue-sonner'

const route = useRoute()
const router = useRouter()
const sub = useSubscriptionService()

const features = [
  'Enhanced third-party business data',
  'Advanced map layers and overlays',
  'Unlimited custom map configurations',
  'Premium navigation and routing',
  'Real-time location sharing',
]

onMounted(async () => {
  const isCheckoutReturn = route.query.checkout === 'success'
  if (isCheckoutReturn) {
    router.replace({ query: {} })
  }
  const status = await sub.verifySubscription()
  if (isCheckoutReturn) {
    if (status.isPremium) {
      toast.success('Welcome to Premium!', {
        id: 'checkout-result',
        description: 'Your subscription is now active.',
      })
    } else {
      toast.info('Processing your subscription...', {
        id: 'checkout-result',
        description: 'It may take a moment to activate. Refresh to check.',
      })
    }
  }
})
</script>

<template>
  <div v-if="sub.billingEnabled.value" class="flex flex-col gap-4">
    <SettingsSection id="plan" title="Plan">
      <div v-if="sub.isPremium.value" class="flex flex-col gap-4">
        <div>
          <p class="text-sm font-medium">Premium</p>
          <p class="text-sm text-muted-foreground">
            You have access to all features.
          </p>
        </div>
        <Button
          v-if="sub.hasSubscription.value"
          variant="outline"
          size="sm"
          class="w-fit"
          @click="sub.openPortal()"
        >
          Manage subscription
          <ExternalLink class="w-3.5 h-3.5" />
        </Button>
      </div>

      <div v-else class="flex flex-col gap-5">
        <div>
          <p class="text-sm font-medium">Free</p>
          <p class="text-sm text-muted-foreground">
            Some features require a Premium subscription.
          </p>
        </div>
        <div class="flex flex-col gap-3">
          <p class="text-xs font-medium text-muted-foreground">
            Included with Premium
          </p>
          <ul class="flex flex-col gap-1.5">
            <li
              v-for="feature in features"
              :key="feature"
              class="flex items-center gap-2 text-sm text-muted-foreground"
            >
              <Check class="w-3.5 h-3.5 text-primary shrink-0" />
              {{ feature }}
            </li>
          </ul>
        </div>
        <Button
          size="sm"
          class="w-fit"
          :loading="sub.loading.value"
          @click="sub.startCheckout()"
        >
          Upgrade to Premium
          <ArrowRight class="w-3.5 h-3.5" />
        </Button>
      </div>
    </SettingsSection>
  </div>
</template>
