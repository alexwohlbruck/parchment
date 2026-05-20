<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { SettingsSection } from '@/components/settings'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ExternalLink, ArrowRight, Check, AlertCircle } from 'lucide-vue-next'
import { useSubscriptionService } from '@/services/subscription.service'
import { toast } from 'vue-sonner'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const sub = useSubscriptionService()

const freeFeatures = computed(() => [
  t('settings.billing.features.basicMapLayers'),
  t('settings.billing.features.placeSearch'),
  t('settings.billing.features.bookmarks'),
  t('settings.billing.features.locationSharing'),
])

const premiumFeatures = computed(() => [
  t('settings.billing.plan.everythingInFree'),
  t('settings.billing.features.businessData'),
  t('settings.billing.features.mapboxEngine'),
  t('settings.billing.features.searchAutoRefresh'),
  // t('settings.billing.features.advancedLayers'),
  // t('settings.billing.features.customMaps'),
  // t('settings.billing.features.routingPreferences'),
  // t('settings.billing.features.weatherVisualizations'),
])

const formattedPrice = computed(() => {
  const d = sub.details.value
  if (!d) return null
  const amount = (d.amount / 100).toFixed(2).replace(/\.00$/, '')
  const symbol = d.currency === 'usd' ? '$' : d.currency.toUpperCase() + ' '
  return `${symbol}${amount}`
})

const formattedInterval = computed(() => {
  const d = sub.details.value
  if (!d) return ''
  return d.interval === 'year'
    ? t('settings.billing.perYear')
    : t('settings.billing.perMonth')
})

const renewalDate = computed(() => {
  const d = sub.details.value
  if (!d?.currentPeriodEnd) return null
  return new Date(d.currentPeriodEnd).toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
})

const isCanceling = computed(
  () => sub.details.value?.cancelAtPeriodEnd ?? false,
)

// Dynamic product pricing from Polar (used for the Premium card when user is NOT subscribed)
const productPrice = computed(() => {
  const p = sub.product.value
  if (!p) return null
  const amount = (p.priceAmount / 100).toFixed(2).replace(/\.00$/, '')
  const symbol =
    p.priceCurrency === 'usd' ? '$' : p.priceCurrency.toUpperCase() + ' '
  return `${symbol}${amount}`
})

const productInterval = computed(() => {
  const p = sub.product.value
  if (!p) return t('settings.billing.perMonth')
  return p.interval === 'year'
    ? t('settings.billing.perYear')
    : t('settings.billing.perMonth')
})

const trialLabel = computed(() => {
  const days = sub.product.value?.trialDays
  if (!days) return null
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
})

onMounted(async () => {
  // Fetch subscription details for billing page display
  sub.fetchDetails()

  const isCheckoutReturn = route.query.checkout === 'success'
  if (!isCheckoutReturn) return

  router.replace({ query: {} })
  const status = await sub.verifySubscription()
  await sub.fetchDetails()
  if (status.isPremium) {
    toast.success(t('settings.billing.checkout.welcomePremium'), {
      id: 'checkout-result',
      description: t('settings.billing.checkout.subscriptionActive'),
    })
  } else {
    toast.info(t('settings.billing.checkout.processing'), {
      id: 'checkout-result',
      description: t('settings.billing.checkout.processingDescription'),
    })
  }
})
</script>

<template>
  <SettingsSection v-if="sub.billingEnabled.value" id="subscription" :title="$t('settings.billing.title')" :frame="false">
    <!-- Active subscription details -->
    <div
      v-if="sub.isPremium.value && sub.details.value"
      class="rounded-lg border border-border bg-card text-card-foreground shadow-xs p-4 flex flex-col"
    >
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <p class="text-sm font-medium">
            {{ sub.details.value.productName }}
          </p>
          <Badge v-if="isCanceling" variant="outline"> {{ $t('settings.billing.canceling') }} </Badge>
        </div>
        <p v-if="formattedPrice" class="text-sm font-medium">
          {{ formattedPrice
          }}<span class="text-muted-foreground font-normal">{{
            formattedInterval
          }}</span>
        </p>
      </div>

      <div
        v-if="isCanceling && renewalDate"
        class="flex items-start gap-2 text-sm text-muted-foreground"
      >
        <AlertCircle class="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>{{ $t('settings.billing.endsOn', { date: renewalDate }) }}</span>
      </div>
      <p v-else-if="renewalDate" class="text-sm text-muted-foreground">
        {{ $t('settings.billing.renews', { date: renewalDate }) }}
      </p>

      <Button
        v-if="sub.hasSubscription.value"
        variant="outline"
        size="sm"
        class="w-fit mt-2.5"
        @click="sub.openPortal()"
      >
        {{ $t('settings.billing.manageSubscription') }}
        <ExternalLink class="w-3 h-3 ml-1" />
      </Button>
    </div>

    <!-- Plan comparison -->
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <!-- Free plan card -->
      <div
        class="rounded-lg border bg-card text-card-foreground shadow-xs p-4 flex flex-col gap-4"
        :class="
          !sub.isPremium.value
            ? 'border-primary bg-primary/[0.03]'
            : 'border-border'
        "
      >
        <div class="flex flex-col gap-1">
          <div class="flex items-center gap-2">
            <p class="text-sm font-medium">{{ $t('settings.billing.plan.free') }}</p>
            <Badge
              v-if="!sub.isPremium.value"
              variant="primary"
              class="text-[10px] px-1.5 py-0"
            >
              {{ $t('settings.billing.current') }}
            </Badge>
          </div>
          <p class="text-xs text-muted-foreground">{{ $t('settings.billing.plan.freeDescription') }}</p>
        </div>

        <p class="text-2xl font-semibold tracking-tight">
          $0
          <span class="text-sm font-normal text-muted-foreground">{{ $t('settings.billing.perMonth') }}</span>
        </p>

        <ul class="flex flex-col gap-1.5 flex-1">
          <li
            v-for="feature in freeFeatures"
            :key="feature"
            class="flex items-center gap-2 text-xs text-muted-foreground"
          >
            <Check class="w-3 h-3 text-primary shrink-0" />
            {{ feature }}
          </li>
        </ul>

      </div>

      <!-- Premium plan card -->
      <div
        class="rounded-lg border bg-card text-card-foreground shadow-xs p-4 flex flex-col gap-4"
        :class="
          sub.isPremium.value
            ? 'border-primary bg-primary/[0.03]'
            : 'border-border'
        "
      >
        <div class="flex flex-col gap-1">
          <div class="flex items-center gap-2">
            <p class="text-sm font-medium">{{ $t('settings.billing.plan.premium') }}</p>
            <Badge
              v-if="sub.isPremium.value"
              variant="primary"
              class="text-[10px] px-1.5 py-0"
            >
              {{ $t('settings.billing.current') }}
            </Badge>
          </div>
          <p class="text-xs text-muted-foreground">
            {{ $t('settings.billing.plan.premiumDescription') }}
          </p>
        </div>

        <p class="text-2xl font-semibold tracking-tight">
          <template v-if="formattedPrice && sub.isPremium.value">
            {{ formattedPrice }}
          </template>
          <template v-else-if="productPrice">
            {{ productPrice }}
          </template>
          <template v-else> $3.50 </template>
          <span class="text-sm font-normal text-muted-foreground">
            <template v-if="sub.isPremium.value && formattedInterval">
              {{ formattedInterval }}
            </template>
            <template v-else>{{ productInterval }}</template>
          </span>
        </p>

        <p
          v-if="!sub.isPremium.value && trialLabel"
          class="text-xs text-primary font-medium -mt-2"
        >
          {{ trialLabel }}
        </p>

        <ul class="flex flex-col gap-1.5 flex-1">
          <li
            v-for="feature in premiumFeatures"
            :key="feature"
            class="flex items-center gap-2 text-xs text-muted-foreground"
          >
            <Check class="w-3 h-3 text-primary shrink-0" />
            {{ feature }}
          </li>
        </ul>

        <Button
          v-if="!sub.isPremium.value"
          size="sm"
          class="w-full"
          :loading="sub.loading.value"
          @click="sub.startCheckout()"
        >
          {{ $t('settings.billing.upgradeToPremium') }}
          <ArrowRight class="w-3.5 h-3.5" />
        </Button>
        <Button
          v-else
          variant="outline"
          size="sm"
          class="w-full"
          @click="sub.openPortal()"
        >
          {{ $t('settings.billing.manageSubscription') }}
          <ExternalLink class="ml-2 w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  </SettingsSection>
</template>
