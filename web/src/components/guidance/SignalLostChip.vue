<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { SignalLow } from 'lucide-vue-next'
import { isAboard } from '@/lib/guidance/guidance-layout'
import { useGuidanceStore } from '@/stores/guidance.store'

const { t } = useI18n()
const guidance = useGuidanceStore()

// Aboard, the transit card already says the ride is estimated.
const shown = computed(() => guidance.signalLost && guidance.status !== 'arrived' && !isAboard(guidance.transit))
</script>

<template>
  <Transition
    enter-active-class="transition duration-300 ease-out"
    enter-from-class="opacity-0 -translate-y-1"
    leave-active-class="transition duration-200 ease-in"
    leave-to-class="opacity-0"
  >
    <div
      v-if="shown"
      class="nav-surface flex w-fit items-center gap-1.5 rounded-full bg-background/95 px-3 py-1.5 text-[13px] font-medium text-muted-foreground shadow-lg ring-1 ring-foreground/5"
      role="status"
    >
      <SignalLow class="size-3.5" />
      <span>{{ t('guidance.signalLost') }}</span>
    </div>
  </Transition>
</template>
