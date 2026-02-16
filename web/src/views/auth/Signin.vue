<script lang="ts" setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { TransitionExpand } from '@morev/vue-transitions'

import Otp from '@/components/auth/forms/Otp.vue'
import SigninForm from '@/components/auth/forms/SigninForm.vue'
import parchmentMapBg from '@/assets/img/parchment-map.png'

const { t } = useI18n()

enum SigninStep {
  email,
  otp,
}
const step = ref<SigninStep>(SigninStep.email)
const email = ref('')
const serverUrl = ref('')

function beginOtp({
  email: _email,
  serverUrl: _serverUrl,
}: {
  email: string
  serverUrl: string
}) {
  step.value = SigninStep.otp
  email.value = _email
  serverUrl.value = _serverUrl
}
</script>

<style scoped>
.signin-container {
  animation: fadeIn 0.6s cubic-bezier(0.4, 0, 0.2, 1);
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.parchment-bg {
  background-image: url('@/assets/img/parchment-map.png');
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  opacity: 0.35;
}

.dark .parchment-bg {
  filter: invert(1);
}

.form-card {
  backdrop-filter: blur(20px);
  box-shadow: 
    0 0 0 1px rgba(0, 0, 0, 0.05),
    0 4px 6px rgba(0, 0, 0, 0.07),
    0 10px 20px rgba(0, 0, 0, 0.08);
}

.dark .form-card {
  box-shadow: 
    0 0 0 1px rgba(255, 255, 255, 0.08),
    0 4px 6px rgba(0, 0, 0, 0.4),
    0 10px 20px rgba(0, 0, 0, 0.5);
}
</style>

<template>
  <div
    class="relative flex flex-col h-full overflow-hidden bg-slate-50 dark:bg-slate-950 pt-[max(env(safe-area-inset-top), 0px)]"
  >
    <!-- Background map image with gradient fade -->
    <div class="absolute inset-0 pointer-events-none">
      <div class="parchment-bg absolute inset-0"></div>
      <!-- Gradient overlay to fade the map into the background -->
      <div class="absolute inset-0 bg-gradient-to-b from-slate-50/50 via-slate-50/30 to-slate-50/50 dark:from-slate-950/50 dark:via-slate-950/30 dark:to-slate-950/50" />
    </div>

    <!-- Sign In Form -->
    <div class="relative z-10 flex-1 flex flex-col h-full justify-center items-center p-6 signin-container">
      <div class="w-full max-w-sm space-y-6">
        <!-- Logo -->
        <div class="flex justify-center">
          <img
            src="@/assets/parchment.svg"
            alt="Parchment"
            class="h-14 w-14 dark:invert"
          />
        </div>

        <!-- Form Card -->
        <div class="form-card bg-white/90 dark:bg-slate-900/90 rounded-xl p-8 space-y-6">
          <!-- Title -->
          <div class="text-center space-y-1">
            <h1 class="text-2xl font-semibold text-slate-900 dark:text-white">
              {{ t('auth.signIn.title') }}
            </h1>
            <p class="text-sm text-slate-600 dark:text-slate-400">
              {{ t('auth.signIn.welcome') }}
            </p>
          </div>

          <!-- Forms -->
          <TransitionExpand :duration="300">
            <div :key="step">
              <SigninForm v-if="step === SigninStep.email" @submit="beginOtp" />
              <Otp
                v-else
                :email="email"
                :server-url="serverUrl"
                @cancel="step = SigninStep.email"
              />
            </div>
          </TransitionExpand>
        </div>

        <!-- Footer Text -->
        <p class="text-center text-xs text-slate-500 dark:text-slate-400">
          {{ t('auth.signIn.termsAndPrivacy') }}
        </p>
      </div>
    </div>
  </div>
</template>
