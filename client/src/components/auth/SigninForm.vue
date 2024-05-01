<script lang="ts" setup>
import { ref } from 'vue'
import axios from 'axios'

import { H3 } from '@/components/ui/typography'
import { Input } from '@/components/ui/input'
import { FingerprintIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'

enum SigninStep {
  email,
  otp,
}

const step = ref<SigninStep>(SigninStep.email)
const email = ref('')
const otp = ref('')
const emit = defineEmits<{
  (e: 'signin', me: object): void
}>()

async function requestOtp() {
  try {
    const response = await axios.post(`http://localhost:5000/auth/verify`, {
      email: email.value,
    })
    if (response.status === 201) {
      step.value = SigninStep.otp
    } else {
      // TODO: Possible other responses
    }
  } catch (error) {
    // TODO: Error states, could not send verification email
  }
}

async function signIn() {
  try {
    const { data } = await axios.post(
      'http://localhost:5000/auth/sessions',
      {
        method: 'otp',
        email: email.value,
        token: otp.value.toString(),
      },
      {
        withCredentials: true,
      },
    )

    // Emit user object to account page. This will be replaced by pinia store in final design
    emit('signin', data.user)
  } catch (error) {
    // TODO: Error state
    console.error(error)
  }
}
</script>

<template>
  <H3>{{ $t('settings.account.title') }}</H3>

  <div class="flex flex-col gap-2">
    <template v-if="step === SigninStep.email">
      <Input type="email" placeholder="Email" v-model="email" />
      <Button @click="requestOtp">Send verification code</Button>
      <hr />
      <Button>
        <FingerprintIcon class="mr-2" />
        Sign in with passkey
      </Button>
    </template>

    <template v-if="step === SigninStep.otp">
      <Input type="number" placeholder="Verification code" v-model="otp" />
      <Button @click="signIn()">Sign in</Button>
    </template>
  </div>
</template>
