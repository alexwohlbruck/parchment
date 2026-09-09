<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
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

onMounted(() => {
  const input = document.getElementById('pin-input')
  input?.focus()
})

const emit = defineEmits(['cancel'])

const formSchema = toTypedSchema(
  z.object({
    pin: z.array(z.coerce.string()).length(8, { message: 'Invalid code' }),
  }),
)

const { handleSubmit, setFieldValue } = useForm({
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
  if (autoSubmit.value) {
    autoSubmit.value = false
    signIn(otp)
  }
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
            @update:model-value="
              arrStr => {
                setFieldValue('pin', arrStr.filter(Boolean))
              }
            "
          >
            <PinInputGroup>
              <template v-for="(id, index) in 8" :key="id">
                <PinInputInput 
                  :index="index"
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
        <FormDescription class="text-center text-xs">
          {{ t('auth.otp.description', { email }) }}
        </FormDescription>
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
        variant="outline" 
        @click="emit('cancel')"
        class="flex-1"
      >
        {{ t('auth.otp.cancel') }}
      </Button>
    </div>
  </form>
</template>
