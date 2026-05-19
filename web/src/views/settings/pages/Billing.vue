<script setup lang="ts">
import { onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { SettingsSection } from '@/components/settings'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Check,
  ExternalLink,
  Sparkles,
  Zap,
  Map,
  Layers,
  Navigation,
  Radio,
} from 'lucide-vue-next'
import { useSubscriptionService } from '@/services/subscription.service'
import { toast } from 'vue-sonner'

const route = useRoute()
const subscriptionService = useSubscriptionService()

const premiumFeatures = [
  {
    icon: Zap,
    title: 'Enhanced data providers',
    description: 'Third-party business data with richer details and reviews',
  },
  {
    icon: Layers,
    title: 'Advanced map layers',
    description: '3D terrain, weather overlays, and more visual layers',
  },
  {
    icon: Map,
    title: 'Custom maps',
    description: 'Unlimited custom map and layer configurations',
  },
  {
    icon: Navigation,
    title: 'Premium navigation',
    description: 'Advanced routing preferences and turn-by-turn options',
  },
  {
    icon: Radio,
    title: 'Real-time location sharing',
    description: 'Share your live location with friends and groups',
  },
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
      <!-- Premium state -->
      <div v-if="subscriptionService.isPremium.value" class="flex flex-col gap-4">
        <div class="flex items-center gap-3">
          <div
            class="flex items-center justify-center w-10 h-10 rounded-xl bg-violet-100 dark:bg-violet-900/40"
          >
            <Sparkles class="w-5 h-5 text-violet-600 dark:text-violet-400" />
          </div>
          <div class="flex-1">
            <div class="flex items-center gap-2">
              <span class="font-semibold">Premium</span>
              <Badge
                variant="secondary"
                class="bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 border-0"
              >
                Active
              </Badge>
            </div>
            <p class="text-sm text-muted-foreground">
              You have access to all premium features.
            </p>
          </div>
        </div>

        <Button
          v-if="subscriptionService.hasSubscription.value"
          variant="outline"
          class="w-fit"
          @click="subscriptionService.openPortal()"
        >
          <ExternalLink class="w-4 h-4" />
          Manage subscription
        </Button>
      </div>

      <!-- Free state -->
      <div v-else class="flex flex-col gap-4">
        <div class="flex items-center gap-3">
          <div
            class="flex items-center justify-center w-10 h-10 rounded-xl bg-muted"
          >
            <Sparkles class="w-5 h-5 text-muted-foreground" />
          </div>
          <div class="flex-1">
            <div class="flex items-center gap-2">
              <span class="font-semibold">Free</span>
            </div>
            <p class="text-sm text-muted-foreground">
              Upgrade to unlock all premium features.
            </p>
          </div>
        </div>

        <div
          class="flex items-center justify-between rounded-xl border border-violet-200 dark:border-violet-800/60 bg-violet-50/50 dark:bg-violet-950/20 p-4"
        >
          <div class="flex items-center gap-3">
            <Sparkles class="w-5 h-5 text-violet-600 dark:text-violet-400 shrink-0" />
            <div>
              <p class="text-sm font-medium">Parchment Premium</p>
              <p class="text-xs text-muted-foreground">
                Get the most out of Parchment
              </p>
            </div>
          </div>
          <Button
            :loading="subscriptionService.loading.value"
            @click="subscriptionService.startCheckout()"
          >
            Upgrade
          </Button>
        </div>
      </div>
    </SettingsSection>

    <SettingsSection
      v-if="!subscriptionService.isPremium.value"
      id="features"
      title="What's included"
    >
      <div class="flex flex-col">
        <div
          v-for="(feature, index) in premiumFeatures"
          :key="feature.title"
        >
          <div class="flex items-start gap-3 py-3">
            <div
              class="flex items-center justify-center w-8 h-8 rounded-lg bg-violet-100 dark:bg-violet-900/30 shrink-0 mt-0.5"
            >
              <component
                :is="feature.icon"
                class="w-4 h-4 text-violet-600 dark:text-violet-400"
              />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium">{{ feature.title }}</p>
              <p class="text-xs text-muted-foreground">
                {{ feature.description }}
              </p>
            </div>
            <Check class="w-4 h-4 text-violet-600 dark:text-violet-400 shrink-0 mt-1" />
          </div>
          <Separator v-if="index < premiumFeatures.length - 1" />
        </div>
      </div>
    </SettingsSection>
  </div>
</template>
