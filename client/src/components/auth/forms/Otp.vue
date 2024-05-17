<script setup lang="ts">
import { onMounted, ref } from 'vue'
import * as z from 'zod'
import { useForm, useIsFormValid } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { useAuthService } from '@/services/auth.service'

import { Button } from '@/components/ui/button'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  PinInput,
  PinInputGroup,
  PinInputInput,
  PinInputSeparator,
} from '@/components/ui/pin-input'

const { email } = defineProps<{
  email: string
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
  await authService.signIn(email, otp)
}
</script>

<template>
  <form class="space-y-6 mx-auto" @submit="onSubmit">
    <FormField v-slot="{ componentField, value }" name="pin">
      <FormItem>
        <FormLabel>Verification code</FormLabel>
        <FormControl>
          <PinInput
            id="pin-input"
            ref="input"
            v-model="value!"
            mode="eager"
            placeholder="○"
            class="flex gap-2 items-center mt-1"
            otp
            type="number"
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
                  :class="{
                    'rounded-r-md': index === 3,
                    'rounded-l-md border': index === 4,
                  }"
                  :index="index"
                />
                <template v-if="index === 3">
                  <PinInputSeparator />
                </template>
              </template>
            </PinInputGroup>
          </PinInput>
        </FormControl>
        <FormDescription>
          We've sent a one-time verification code to
          <span class="font-semibold">{{ email }} </span>. Copy it here to
          verify your identity.
        </FormDescription>
      </FormItem>
    </FormField>

    <div class="flex gap-2">
      <Button type="submit" :disabled="!isFormValid">Submit</Button>
      <Button variant="outline" @click="emit('cancel')">Cancel</Button>
    </div>
  </form>
</template>
