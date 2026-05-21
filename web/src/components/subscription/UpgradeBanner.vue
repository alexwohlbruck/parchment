<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSubscriptionService, type Tier } from '@/services/subscription.service'
import { Button } from '@/components/ui/button'
import { ArrowRight, Lock } from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    /** i18n key suffix for the feature description, e.g. "library" */
    feature?: string
    /** Minimum tier required */
    requiredTier?: Tier
    /** Custom title override */
    title?: string
    /** Custom description override */
    description?: string
  }>(),
  {
    requiredTier: 'basic',
  },
)

const { t } = useI18n()
const sub = useSubscriptionService()

const show = computed(() => sub.billingEnabled.value)

const tierLabel = computed(() => {
  if (props.requiredTier === 'premium') return t('settings.billing.plan.premium')
  return t('settings.billing.plan.basic')
})

const bannerTitle = computed(() => {
  if (props.title) return props.title
  return t('subscription.upgradeBanner.title', { tier: tierLabel.value })
})

const bannerDescription = computed(() => {
  if (props.description) return props.description
  return t('subscription.upgradeBanner.description', { tier: tierLabel.value })
})

function handleUpgrade() {
  sub.startCheckout(props.requiredTier)
}
</script>

<template>
  <div
    v-if="show"
    class="flex flex-col items-center justify-center gap-4 p-8 text-center"
  >
    <div class="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
      <Lock class="w-5 h-5 text-muted-foreground" />
    </div>
    <div class="flex flex-col gap-1 max-w-xs">
      <h3 class="text-sm font-semibold text-foreground">
        {{ bannerTitle }}
      </h3>
      <p class="text-xs text-muted-foreground">
        {{ bannerDescription }}
      </p>
    </div>
    <Button size="sm" @click="handleUpgrade">
      <template v-if="requiredTier === 'premium'">
        {{ $t('settings.billing.upgradeToPremium') }}
      </template>
      <template v-else>
        {{ $t('settings.billing.upgradeToBasic') }}
      </template>
      <ArrowRight class="w-3.5 h-3.5" />
    </Button>
  </div>
</template>
