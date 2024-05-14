<script setup lang="ts">
import { onMounted, ref } from 'vue'
import * as z from 'zod'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { useAuthService } from '@/services/auth.service'

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
const email = ref('')

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

useForm({
  validationSchema: toTypedSchema(
    z.object({
      email: z.string().email().min(1, 'required'),
    }),
  ),
})
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
        <FormMessage />
      </FormItem>
    </FormField>

    <Button type="submit" class="w-full">Send verification code</Button>
  </form>
  <hr />
  <Button @click="authService.signInWithPasskey(false)" :icon="FingerprintIcon">
    Sign in with passkey
  </Button>
</template>
