<script setup lang="ts">
import { computed, inject, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSubscriptionService, type Tier } from '@/services/subscription.service'
import { validateKey } from './types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Check, ArrowRight } from 'lucide-vue-next'

const { t } = useI18n()
const sub = useSubscriptionService()

const validation = inject(validateKey)

onMounted(() => {
  validation?.register(() => true)
})

function formatPrice(amount: number, currency: string) {
  const formatted = (amount / 100).toFixed(2).replace(/\.00$/, '')
  const symbol = currency === 'usd' ? '$' : currency.toUpperCase() + ' '
  return `${symbol}${formatted}`
}

function formatInterval(interval: string) {
  return interval === 'year'
    ? t('settings.billing.perYear')
    : t('settings.billing.perMonth')
}

function formatTrialDays(days: number) {
  if (days % 30 === 0 && days >= 30) {
    const months = days / 30
    return months === 1
      ? t('settings.billing.trial.monthFree')
      : t('settings.billing.trial.monthsFree', { count: months })
  }
  if (days % 7 === 0 && days >= 7) {
    const weeks = days / 7
    return weeks === 1
      ? t('settings.billing.trial.weekFree')
      : t('settings.billing.trial.weeksFree', { count: weeks })
  }
  return days === 1
    ? t('settings.billing.trial.dayFree')
    : t('settings.billing.trial.daysFree', { count: days })
}

type TierCard = {
  id: Tier
  label: string
  description: string
  features: string[]
  isCurrent: boolean
  price: string | null
  interval: string
  trialLabel: string | null
  canUpgrade: boolean
  upgradeLabel: string
  checkoutTier: Tier
}

const tiers = computed<TierCard[]>(() => {
  const currentTier = sub.tier.value

  return [
    {
      id: 'free' as Tier,
      label: t('settings.billing.plan.free'),
      description: t('settings.billing.plan.freeDescription'),
      features: [
        t('settings.billing.features.placeSearch'),
        t('settings.billing.features.directions'),
        t('settings.billing.features.basicMapLayers'),
      ],
      isCurrent: currentTier === 'free',
      price: '$0',
      interval: t('settings.billing.perMonth'),
      trialLabel: null,
      canUpgrade: false,
      upgradeLabel: '',
      checkoutTier: 'free' as Tier,
    },
    {
      id: 'basic' as Tier,
      label: t('settings.billing.plan.basic'),
      description: t('settings.billing.plan.basicDescription'),
      features: [
        t('settings.billing.plan.everythingInFree'),
        t('settings.billing.features.bookmarks'),
        t('settings.billing.features.collections'),
        t('settings.billing.features.friends'),
        t('settings.billing.features.locationSharing'),
        t('settings.billing.features.mapNotes'),
        t('settings.billing.features.customLayers'),
        t('settings.billing.features.integrations'),
      ],
      isCurrent: currentTier === 'basic',
      price: sub.basicProduct.value
        ? formatPrice(sub.basicProduct.value.priceAmount, sub.basicProduct.value.priceCurrency)
        : null,
      interval: sub.basicProduct.value
        ? formatInterval(sub.basicProduct.value.interval)
        : t('settings.billing.perMonth'),
      trialLabel: currentTier === 'free' && sub.basicProduct.value?.trialDays
        ? formatTrialDays(sub.basicProduct.value.trialDays)
        : null,
      canUpgrade: currentTier === 'free',
      upgradeLabel: t('settings.billing.upgradeToBasic'),
      checkoutTier: 'basic' as Tier,
    },
    {
      id: 'premium' as Tier,
      label: t('settings.billing.plan.premium'),
      description: t('settings.billing.plan.premiumDescription'),
      features: [
        t('settings.billing.plan.everythingInBasic'),
        t('settings.billing.features.businessData'),
        t('settings.billing.features.searchAutoRefresh'),
        t('settings.billing.features.mapboxEngine'),
      ],
      isCurrent: currentTier === 'premium',
      price: sub.premiumProduct.value
        ? formatPrice(sub.premiumProduct.value.priceAmount, sub.premiumProduct.value.priceCurrency)
        : null,
      interval: sub.premiumProduct.value
        ? formatInterval(sub.premiumProduct.value.interval)
        : t('settings.billing.perMonth'),
      trialLabel: currentTier !== 'premium' && sub.premiumProduct.value?.trialDays
        ? formatTrialDays(sub.premiumProduct.value.trialDays)
        : null,
      canUpgrade: currentTier !== 'premium',
      upgradeLabel: t('settings.billing.upgradeToPremium'),
      checkoutTier: 'premium' as Tier,
    },
  ]
})

function checkout(tier: Tier) {
  const successUrl = `${window.location.origin}${window.location.pathname}?checkout=success`
  sub.startCheckout(tier, successUrl)
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="text-center space-y-1">
      <h2 class="text-xl font-semibold">
        {{ t('onboarding.subscription.title') }}
      </h2>
      <p class="text-sm text-muted-foreground">
        {{ t('onboarding.subscription.description') }}
      </p>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div
        v-for="tier in tiers"
        :key="tier.id"
        class="rounded-lg border bg-card text-card-foreground shadow-xs p-4 flex flex-col gap-4"
        :class="tier.isCurrent ? 'border-primary bg-primary/[0.03]' : 'border-border'"
      >
        <div class="flex flex-col gap-1">
          <div class="flex items-center gap-2">
            <p class="text-sm font-medium">{{ tier.label }}</p>
            <Badge
              v-if="tier.isCurrent"
              variant="primary"
              class="text-[10px] px-1.5 py-0"
            >
              {{ t('settings.billing.current') }}
            </Badge>
          </div>
          <p class="text-xs text-muted-foreground">{{ tier.description }}</p>
        </div>

        <div>
          <p class="text-2xl font-semibold tracking-tight">
            {{ tier.price }}
            <span class="text-sm font-normal text-muted-foreground">{{ tier.interval }}</span>
          </p>
          <p
            v-if="tier.trialLabel"
            class="text-xs text-primary font-medium mt-1"
          >
            {{ tier.trialLabel }}
          </p>
        </div>

        <ul class="flex flex-col gap-1.5 flex-1">
          <li
            v-for="feature in tier.features"
            :key="feature"
            class="flex items-center gap-2 text-xs text-muted-foreground"
          >
            <Check class="w-3 h-3 text-primary shrink-0" />
            {{ feature }}
          </li>
        </ul>

        <Button
          v-if="tier.canUpgrade && tier.id !== 'free'"
          size="sm"
          class="w-full"
          :loading="sub.checkingOutTier.value === tier.checkoutTier"
          @click="checkout(tier.checkoutTier)"
        >
          {{ tier.upgradeLabel }}
          <ArrowRight class="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  </div>
</template>
