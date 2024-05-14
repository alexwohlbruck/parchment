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

function beginOtp(_email: string) {
  step.value = SigninStep.otp
  email.value = _email
}
</script>

<style>
#map-graphic {
  background-image: url('@/assets/img/map.png');
  background-size: cover;
  background-position: center;
}
</style>

<template>
  <div class="flex h-full gap-4 p-4 bg-cyan-50 dark:bg-cyan-950">
    <div class="flex-1 flex flex-col h-full">
      <H4>Parchment</H4>
      <div class="flex-1 flex flex-col justify-center items-center gap-2">
        <div class="flex flex-col gap-2 w-[20rem] max-w-full">
          <H2>Sign in</H2>

          <template v-if="step === SigninStep.email">
            <SigninForm @submit="({ email }) => beginOtp(email)" />
          </template>

          <template v-if="step === SigninStep.otp">
            <Otp :email="email" />
          </template>
        </div>
      </div>
    </div>

    <div class="flex-1 flex flex-col h-full">
      <div id="map-graphic" class="bg-blue-200 rounded-3xl h-full"></div>
    </div>
  </div>
</template>
