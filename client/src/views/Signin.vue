<script lang="ts" setup>
import { onMounted, ref } from 'vue'
import { api } from '@/lib/api'

import { H2 } from '@/components/ui/typography'
import { Input } from '@/components/ui/input'
import { FingerprintIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { useAuthService } from '@/services/auth.service'

enum SigninStep {
  email,
  otp,
}

const authService = useAuthService()
const step = ref<SigninStep>(SigninStep.email)
const email = ref('')
const otp = ref('')

onMounted(() => {
  authService.signInWithPasskey(true)
})

async function requestOtp() {
  await authService.verifyEmail(email.value)
  step.value = SigninStep.otp
}

async function signIn() {
  await authService.signIn(email.value, otp.value.toString())
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
      <div id="map-graphic" class="bg-emerald-300 rounded-3xl h-full"></div>
    </div>

    <div class="flex-1 flex flex-col justify-center items-center gap-2">
      <div class="flex flex-col gap-2 w-[20rem] max-w-full">
        <H2>Sign in</H2>
        <template v-if="step === SigninStep.email">
          <Input
            type="email"
            placeholder="Email"
            v-model="email"
            autocomplete="username webauthn"
          />
          <Button @click="requestOtp">Send verification code</Button>
          <hr />
          <Button
            @click="authService.signInWithPasskey(false)"
            :icon="FingerprintIcon"
          >
            Sign in with passkey
          </Button>
        </template>

        <template v-if="step === SigninStep.otp">
          <Input type="number" placeholder="Verification code" v-model="otp" />
          <Button @click="signIn()">Verify</Button>
        </template>
      </div>
    </div>
  </div>
</template>
