<script lang="ts" setup>
import { ref } from 'vue'

import { H2, H4 } from '@/components/ui/typography'
import Otp from '@/components/auth/forms/Otp.vue'
import SigninForm from '@/components/auth/forms/SigninForm.vue'

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

<style>
#map-graphic {
  background-image: url('@/assets/img/map.png');
  background-size: cover;
  background-position: center;
  filter: saturate(1.5);
}
</style>

<template>
  <div
    class="flex flex-col sm:flex-row h-full gap-4 p-4 bg-cyan-50 dark:bg-slate-900"
  >
    <div class="flex-1 flex flex-col h-full">
      <div id="map-graphic" class="bg-blue-200 rounded-3xl h-full"></div>
    </div>

    <div class="sm:flex-1 flex flex-col h-full">
      <H4>Parchment</H4>
      <div class="flex-1 flex flex-col justify-center items-center gap-2">
        <div class="flex flex-col gap-2">
          <H2>Sign in</H2>

          <template v-if="step === SigninStep.email">
            <div class="w-64 flex flex-col gap-2">
              <SigninForm @submit="beginOtp" />
            </div>
          </template>

          <template v-if="step === SigninStep.otp">
            <div class="w-96 flex flex-col gap-2">
              <Otp
                :email="email"
                :server-url="serverUrl"
                @cancel="step = SigninStep.email"
              />
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
