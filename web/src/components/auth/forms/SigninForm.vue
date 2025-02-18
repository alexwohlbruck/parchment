<script setup lang="ts">
import { onMounted, ref } from 'vue'
import * as z from 'zod'
import { useForm, useIsFormValid } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { useAuthService } from '@/services/auth.service'
import { useAppService } from '@/services/app.service'
import { isTauri } from '@/lib/api'

import { Input } from '@/components/ui/input'
import { FingerprintIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'

import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from '@/components/ui/form'

const authService = useAuthService()
const appService = useAppService()
const email = ref('')
const awaitingPasskey = ref(false)

onMounted(() => {
  authService.signInWithPasskey(true)
})

const emit = defineEmits({
  submit: ({ email }) => {
    return email.length
  },
})

async function requestOtp() {
  await authService.verifyEmail(email.value)
  emit('submit', { email: email.value })
}

async function startPasskeySignin() {
  if (isTauri) {
    return appService.toast('Passkey sign in not supported') // TODO: i18n
  }
  awaitingPasskey.value = true
  try {
    await authService.signInWithPasskey(false)
  } finally {
    awaitingPasskey.value = false
  }
}

useForm({
  validationSchema: toTypedSchema(
    z.object({
      email: z.string().email(),
    }),
  ),
})

const isFormValid = useIsFormValid()
</script>

<template>
  <form @submit.prevent="requestOtp()">
    <FormField v-slot="{ componentField }" name="email">
      <FormItem>
        <FormLabel>Email</FormLabel>
        <FormControl>
          <Input
            autofocus
            v-bind="componentField"
            type="email"
            placeholder="magellan@parchment.app"
            v-model="email"
            autocomplete="username webauthn"
          />
        </FormControl>
        <FormDescription />
      </FormItem>
    </FormField>

    <Button type="submit" class="w-full" :disabled="!isFormValid">
      Send verification code
    </Button>
  </form>

  <div class="flex w-full items-center" v-if="!isTauri">
    <hr class="flex-1" />
    <span class="px-3 text-sm font-semibold">Or</span>
    <hr class="flex-1" />
  </div>

  <Button
    v-if="!isTauri"
    @click="startPasskeySignin"
    :icon="FingerprintIcon"
    :loading="awaitingPasskey"
  >
    Sign in with passkey
  </Button>
</template>
