<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTimeoutFn } from '@vueuse/core'
import * as z from 'zod'
import { useForm, useIsFormValid } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { useAuthService } from '@/services/auth.service'
import { api } from '@/lib/api'

import { Button } from '@/components/ui/button'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from '@/components/ui/form'
import {
  PinInput,
  PinInputGroup,
  PinInputInput,
  PinInputSeparator,
} from '@/components/ui/pin-input'

const { t } = useI18n()

const { email, serverUrl } = defineProps<{
  email: string
  serverUrl?: string
}>()

const input = ref<InstanceType<typeof PinInput>>()
const autoSubmit = ref(true) // Auto submit the form when the OTP is complete, only the first time
const authService = useAuthService()
const resending = ref(false)
const resendStatus = ref<'sent' | 'error' | null>(null)
const { isPending: resendCooldown, start: startResendCooldown } = useTimeoutFn(
  () => { resendStatus.value = null },
  30_000,
  { immediate: false },
)

async function resendEmail() {
  if (resending.value || resendCooldown.value) return
  resending.value = true
  resendStatus.value = null

  try {
    await authService.verifyEmail(email)
    resetForm()
    autoSubmit.value = true
    resendStatus.value = 'sent'
    startResendCooldown()
  } catch {
    resendStatus.value = 'error'
  } finally {
    resending.value = false
  }
}

onMounted(() => {
  const input = document.getElementById('pin-input')
  input?.focus()
})

const emit = defineEmits(['cancel'])

const formSchema = toTypedSchema(
  z.object({
    pin: z.array(z.string().regex(/^\d$/)).length(8, { message: 'Invalid code' }),
  }),
)

const { handleSubmit, setFieldValue, resetForm, values } = useForm({
  validationSchema: formSchema,
  initialValues: {
    pin: [],
  },
})

const isFormValid = useIsFormValid()

const onSubmit = handleSubmit(({ pin }) => {
  const otp = pin.join('')
  signIn(otp)
})

const handleComplete = (e: string[]) => {
  const otp = e.join('')
  if (autoSubmit.value && /^\d{8}$/.test(otp)) {
    autoSubmit.value = false
    signIn(otp)
  }
}

async function handlePaste(event: ClipboardEvent, index: number) {
  const digits = event.clipboardData?.getData('text').replace(/\D/g, '')
  if (!digits) return

  const start = digits.length >= 8 ? 0 : index
  const pin = [...(values.pin ?? [])]
  pin.splice(start, Math.min(digits.length, 8 - start), ...digits.slice(0, 8 - start))
  setFieldValue('pin', pin)

  await nextTick()
  const inputs = (event.target as HTMLInputElement).form?.querySelectorAll<HTMLInputElement>(
    'input[autocomplete="one-time-code"]',
  )
  inputs?.[Math.min(start + digits.length, 7)]?.focus()
}

async function signIn(otp: string) {
  const originalBaseURL = api.defaults.baseURL

  try {
    if (serverUrl && serverUrl !== 'https://api.parchment.app') {
      api.defaults.baseURL = serverUrl
    }

    await authService.signIn(email, otp)
  } finally {
    api.defaults.baseURL = originalBaseURL
  }
}
</script>

<template>
  <form class="space-y-5" @submit="onSubmit">
    <FormField v-slot="{ componentField, value }" name="pin">
      <FormItem class="space-y-3">
        <FormLabel>{{ t('auth.otp.title') }}</FormLabel>
        <FormControl>
          <PinInput
            id="pin-input"
            ref="input"
            v-model="value!"
            mode="eager"
            placeholder="○"
            class="flex gap-2 items-center justify-center"
            otp
            :name="componentField.name"
            @complete="handleComplete"
            @update:model-value="setFieldValue('pin', $event)"
          >
            <PinInputGroup>
              <template v-for="(id, index) in 8" :key="id">
                <PinInputInput 
                  :index="index"
                  inputmode="numeric"
                  pattern="[0-9]*"
                  @paste.capture.stop.prevent="handlePaste($event, index)"
                  :class="{
                    'rounded-l-md border-l': index === 0 || index === 4,
                    'rounded-r-md': index === 3 || index === 7,
                    'border-l-0': index === 1 || index === 2 || index === 5 || index === 6,
                  }"
                  class="h-10 w-9 text-sm font-semibold"
                />
                <template v-if="index === 3">
                  <PinInputSeparator class="text-muted-foreground" />
                </template>
              </template>
            </PinInputGroup>
          </PinInput>
        </FormControl>
        <div class="space-y-1 text-center text-xs text-muted-foreground">
          <FormDescription class="text-xs leading-6">
            {{ t('auth.otp.description', { email }) }}
            <button
              type="button"
              class="ml-1 inline rounded-sm text-xs font-medium text-muted-foreground underline decoration-muted-foreground/40 underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:no-underline disabled:opacity-60"
              :disabled="resending || resendCooldown"
              @click="resendEmail"
            >
              {{ t(resending ? 'auth.otp.resending' : 'auth.otp.resend') }}
            </button>
          </FormDescription>
          <p v-if="resendStatus" role="status">
            {{ t(resendStatus === 'sent' ? 'auth.otp.resent' : 'auth.otp.resendFailed') }}
          </p>
        </div>
      </FormItem>
    </FormField>

    <div class="flex gap-2">
      <Button 
        type="submit" 
        :disabled="!isFormValid"
        class="flex-1"
      >
        {{ t('auth.otp.submit') }}
      </Button>
      <Button 
        type="button"
        variant="outline" 
        @click="emit('cancel')"
        class="flex-1"
      >
        {{ t('auth.otp.cancel') }}
      </Button>
    </div>
  </form>
</template>
