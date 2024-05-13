<script lang="ts" setup>
import { onMounted, ref } from 'vue'
import { api } from '@/lib/api'

import { H3 } from '@/components/ui/typography'
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

<template>
  <H3>{{ $t('settings.account.title') }}</H3>

  <div class="flex flex-col gap-2">
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
      <Button @click="signIn()">Sign in</Button>
    </template>
  </div>
</template>
