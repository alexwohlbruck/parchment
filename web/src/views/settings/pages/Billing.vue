<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { SettingsSection } from '@/components/settings'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ExternalLink, AlertCircle } from 'lucide-vue-next'
import { useSubscriptionService } from '@/services/subscription.service'
import { toast } from 'vue-sonner'
import PlanSelector from '@/components/subscription/PlanSelector.vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const sub = useSubscriptionService()

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

const formattedSubPrice = computed(() => {
  const d = sub.details.value
  if (!d) return null
  return formatPrice(d.amount, d.currency)
})

const formattedSubInterval = computed(() => {
  const d = sub.details.value
  if (!d) return ''
  return formatInterval(d.interval)
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

onMounted(async () => {
  sub.fetchDetails()

  const isCheckoutReturn = route.query.checkout === 'success'
  if (!isCheckoutReturn) return

  router.replace({ query: {} })
  const status = await sub.verifySubscription()
  await sub.fetchDetails()
  if (status.isPremium || status.isBasic) {
    const tierName = status.isPremium ? 'Premium' : 'Basic'
    toast.success(t('settings.billing.checkout.welcomeTier', { tier: tierName }), {
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
      v-if="(sub.tier.value === 'basic' || sub.tier.value === 'premium') && sub.details.value"
      class="rounded-lg border border-border bg-card text-card-foreground shadow-xs p-4 flex flex-col"
    >
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <p class="text-sm font-medium">
            {{ sub.details.value.productName }}
          </p>
          <Badge v-if="isCanceling" variant="outline"> {{ $t('settings.billing.canceling') }} </Badge>
        </div>
        <p v-if="formattedSubPrice" class="text-sm font-medium">
          {{ formattedSubPrice
          }}<span class="text-muted-foreground font-normal">{{
            formattedSubInterval
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

    <PlanSelector show-manage-button />
  </SettingsSection>
</template>
