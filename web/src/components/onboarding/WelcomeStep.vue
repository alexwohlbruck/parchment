<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Compass, Lock, Map, TramFront } from 'lucide-vue-next'
import OnboardingHeader from './OnboardingHeader.vue'

const { t } = useI18n()
const highlights = { private: Lock, open: Map, transit: TramFront }
</script>

<template>
  <div class="flex flex-col gap-6">
    <OnboardingHeader
      :title="t('onboarding.welcome.title')"
      :description="t('onboarding.welcome.description')"
      :icon="Compass"
    />

    <ul class="mx-auto space-y-3">
      <li
        v-for="(icon, key, i) in highlights"
        :key="key"
        class="welcome-highlight flex items-center gap-3"
        :style="{ animationDelay: `${260 + i * 90}ms` }"
      >
        <span class="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary" aria-hidden="true">
          <component :is="icon" class="size-4" />
        </span>
        <span class="text-sm font-medium">{{ t(`onboarding.welcome.${key}`) }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.welcome-highlight { animation: highlight-in 480ms cubic-bezier(0.2, 0.7, 0.2, 1) both; }

@keyframes highlight-in {
  from { opacity: 0; transform: translateY(6px); }
}

@media (prefers-reduced-motion: reduce) {
  .welcome-highlight { animation: none; }
}
</style>
