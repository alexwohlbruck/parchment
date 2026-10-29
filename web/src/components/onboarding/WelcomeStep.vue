<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Bike, Compass, Globe, Lock, MapPin, Route, TramFront } from 'lucide-vue-next'
import OnboardingHeader from './OnboardingHeader.vue'

const { t } = useI18n()

const stops = [
  { icon: MapPin, x: 14, y: 70, tilt: -8 },
  { icon: TramFront, x: 30, y: 24, tilt: 6 },
  { icon: Bike, x: 72, y: 74, tilt: -5 },
  { icon: Lock, x: 87, y: 28, tilt: 9 },
]
const highlights = { private: Lock, open: Globe, transit: Route }
</script>

<template>
  <div class="flex flex-col gap-6">
    <OnboardingHeader
      :title="t('onboarding.welcome.title')"
      :description="t('onboarding.welcome.description')"
      :icon="Compass"
      tall
    >
      <template #art>
        <svg class="absolute inset-0 size-full text-primary" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path
            class="welcome-route"
            d="M14 70 C 18 40, 26 30, 30 24 S 52 30, 50 50 S 64 80, 72 74 S 84 40, 87 28"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            vector-effect="non-scaling-stroke"
          />
        </svg>
        <span
          v-for="(stop, i) in stops"
          :key="i"
          class="welcome-stop absolute flex size-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xl border bg-background text-primary shadow-sm"
          :style="{ left: `${stop.x}%`, top: `${stop.y}%`, '--tilt': `${stop.tilt}deg`, animationDelay: `${300 + i * 110}ms` }"
          aria-hidden="true"
        >
          <component :is="stop.icon" class="size-4" :stroke-width="1.75" />
        </span>
      </template>
    </OnboardingHeader>

    <div class="grid grid-cols-3 gap-2">
      <div
        v-for="(icon, key, i) in highlights"
        :key="key"
        class="welcome-highlight flex flex-col items-center gap-2 rounded-xl border bg-muted/40 px-2 py-3 text-center"
        :style="{ animationDelay: `${500 + i * 90}ms` }"
      >
        <component :is="icon" class="size-4 text-primary" aria-hidden="true" />
        <p class="text-pretty text-xs font-medium leading-snug sm:text-sm">{{ t(`onboarding.welcome.${key}`) }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.welcome-route {
  stroke-dasharray: 0.1 7;
  opacity: 0.45;
  animation: route-in 900ms 150ms ease-out both;
}

.welcome-stop {
  transform: translate(-50%, -50%) rotate(var(--tilt));
  animation: stop-in 520ms cubic-bezier(0.34, 1.5, 0.5, 1) both;
}

.welcome-highlight { animation: highlight-in 480ms cubic-bezier(0.2, 0.7, 0.2, 1) both; }

@keyframes route-in {
  from { opacity: 0; clip-path: inset(0 100% 0 0); }
  to { clip-path: inset(0 0 0 0); }
}

@keyframes stop-in {
  from { opacity: 0; transform: translate(-50%, -50%) rotate(0deg) scale(0.5); }
}

@keyframes highlight-in {
  from { opacity: 0; transform: translateY(6px); }
}

@media (prefers-reduced-motion: reduce) {
  .welcome-route, .welcome-stop, .welcome-highlight { animation: none; }
}
</style>
