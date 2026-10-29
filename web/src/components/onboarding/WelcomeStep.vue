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
const INK_STROKES = ['M2 6 C 30 2, 60 9, 98 4', 'M2 5 C 28 9, 66 1, 98 6', 'M2 4 C 34 8, 62 2, 98 5']
</script>

<template>
  <div class="flex flex-col gap-6">
    <OnboardingHeader
      :title="t('onboarding.welcome.title')"
      :description="t('onboarding.welcome.description')"
      tall
      bleed
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

    <ul class="grid gap-5 sm:grid-cols-3 sm:gap-4">
      <li
        v-for="(icon, key, i) in highlights"
        :key="key"
        class="welcome-highlight flex items-start gap-4 sm:flex-col sm:items-center sm:gap-2 sm:text-center"
        :style="{ '--delay': `${450 + i * 120}ms` }"
      >
        <component :is="icon" class="mt-1.5 size-5 shrink-0 text-primary sm:mt-0" :stroke-width="1.75" aria-hidden="true" />
        <div class="min-w-0">
          <p class="relative inline-block font-display-heavy text-2xl leading-none">
            {{ t(`onboarding.welcome.${key}`) }}
            <svg class="welcome-ink absolute -bottom-2 left-0 h-2.5 w-full text-primary" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
              <path :d="INK_STROKES[i]" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" pathLength="1" vector-effect="non-scaling-stroke" />
            </svg>
          </p>
          <p class="mt-3 text-balance text-sm leading-snug text-muted-foreground">{{ t(`onboarding.welcome.${key}Detail`) }}</p>
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

.welcome-ink path {
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  opacity: 0.55;
  animation: ink-in 700ms calc(var(--delay) + 250ms) cubic-bezier(0.6, 0, 0.2, 1) forwards;
}

@keyframes ink-in {
  to { stroke-dashoffset: 0; }
}

.welcome-highlight { animation: highlight-in 480ms var(--delay) cubic-bezier(0.2, 0.7, 0.2, 1) both; }

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
  .welcome-route, .welcome-stop, .welcome-highlight,
  :global(.onboarding-step-leave-active) .welcome-stop,
  :global(.onboarding-step-leave-active) .welcome-route { animation: none; }
  .welcome-ink path { animation: none; stroke-dashoffset: 0; }
}
</style>
