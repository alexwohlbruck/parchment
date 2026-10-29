<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Bike, Leaf, Lock, MapPin, TramFront, Users } from 'lucide-vue-next'
import OnboardingHeader from './OnboardingHeader.vue'

const { t } = useI18n()

const stops = [
  { icon: MapPin, x: 14, y: 70, tilt: -8 },
  { icon: TramFront, x: 30, y: 24, tilt: 6 },
  { icon: Bike, x: 72, y: 74, tilt: -5 },
  { icon: Lock, x: 87, y: 28, tilt: 9 },
]
const highlights = { privacy: Lock, sustainability: Leaf, community: Users }
</script>

<template>
  <div class="flex flex-col gap-6">
    <OnboardingHeader
      :title="t('onboarding.welcome.title')"
      :description="t('onboarding.welcome.description')"
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

    <div class="welcome-pillars flex items-center gap-3 text-sm text-muted-foreground" aria-hidden="true">
      <span class="h-px flex-1 bg-border" />
      {{ t('onboarding.welcome.pillars') }}
      <span class="h-px flex-1 bg-border" />
    </div>
    <ul :aria-label="t('onboarding.welcome.pillars')" class="-mt-2 grid grid-cols-3 gap-3 px-1 sm:gap-5 sm:px-4">
      <li
        v-for="(icon, key, i) in highlights"
        :key="key"
        class="welcome-highlight"
        :style="{ animationDelay: `${450 + i * 110}ms` }"
      >
        <div class="welcome-stamp" :style="{ '--tilt': `${[-3, 2, -1.5][i]}deg` }">
          <div class="stamp-face flex h-full flex-col items-center gap-2 px-2 pb-3 pt-4 text-center">
            <component :is="icon" class="size-6 text-primary" :stroke-width="1.5" aria-hidden="true" />
            <p class="font-display text-sm font-semibold leading-tight sm:text-base">{{ t(`onboarding.welcome.${key}`) }}</p>
            <p class="text-pretty text-[11px] leading-snug opacity-70 sm:text-xs">{{ t(`onboarding.welcome.${key}Detail`) }}</p>
          </div>
        </div>
      </li>
    </ul>
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

:global(.onboarding-step-leave-active) .welcome-stop {
  animation: stop-out 260ms cubic-bezier(0.5, 0, 0.9, 0.5) both;
}

:global(.onboarding-step-leave-active) .welcome-route { animation: route-out 300ms ease-in both; }

.welcome-pillars { animation: highlight-in 480ms 380ms cubic-bezier(0.2, 0.7, 0.2, 1) both; }

.welcome-stamp {
  --paper: #f7efe0;
  height: 100%;
  padding: 6px;
  color: #4a3720;
  background: radial-gradient(circle, transparent 2.6px, var(--paper) 3px) -5px -5px / 10px 10px;
  filter: drop-shadow(0 4px 8px rgb(42 29 14 / 0.18));
  rotate: var(--tilt);
  transition: rotate 320ms cubic-bezier(0.34, 1.5, 0.5, 1), translate 320ms cubic-bezier(0.34, 1.5, 0.5, 1);
}

.welcome-stamp:hover {
  rotate: 0deg;
  translate: 0 -3px;
}

.stamp-face {
  background: linear-gradient(160deg, #fbf5ea, #efe2c8);
  box-shadow: inset 0 0 0 1px #6b4f2a26, inset 0 0 0 4px #fbf5ea, inset 0 0 0 5px #6b4f2a1f;
}

.welcome-highlight { animation: highlight-in 480ms cubic-bezier(0.2, 0.7, 0.2, 1) both; }

@keyframes route-in {
  from { opacity: 0; clip-path: inset(0 100% 0 0); }
  to { clip-path: inset(0 0 0 0); }
}

@keyframes stop-in {
  from { opacity: 0; transform: translate(-50%, -50%) rotate(0deg) scale(0.5); }
}

@keyframes stop-out {
  to { opacity: 0; transform: translate(-50%, -30%) rotate(calc(var(--tilt) * -2)) scale(0.6); }
}

@keyframes route-out {
  to { opacity: 0; clip-path: inset(0 0 0 100%); }
}

@keyframes highlight-in {
  from { opacity: 0; transform: translateY(10px) scale(0.94); }
}

@media (prefers-reduced-motion: reduce) {
  .welcome-route, .welcome-stop, .welcome-highlight, .welcome-pillars,
  :global(.onboarding-step-leave-active) .welcome-stop,
  :global(.onboarding-step-leave-active) .welcome-route { animation: none; }
}
</style>
