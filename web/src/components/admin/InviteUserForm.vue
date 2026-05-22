<script setup lang="ts">
import { ref } from 'vue'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { z } from 'zod'
import type { Role } from '@/types/auth.types'

import { FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const props = defineProps<{
  roles: Role[]
}>()

const schema = toTypedSchema(
  z.object({
    firstName: z.string().min(1, 'Required'),
    lastName: z.string().min(1, 'Required'),
    email: z.string().email('Invalid email'),
  }),
)

const { handleSubmit } = useForm({
  validationSchema: schema,
  initialValues: {
    firstName: '',
    lastName: '',
    email: '',
  },
})

const selectedRole = ref('user')

defineExpose({
  submit: () =>
    new Promise(resolve => {
      handleSubmit(formValues => {
        resolve({
          ...formValues,
          role: selectedRole.value,
        })
      })()
      setTimeout(() => resolve(false), 0)
    }),
})
</script>

<template>
  <form class="flex flex-col gap-4" @submit.prevent>
    <div class="grid grid-cols-2 gap-3">
      <FormField v-slot="{ componentField }" name="firstName">
        <FormItem>
          <FormLabel>First name</FormLabel>
          <FormControl>
            <Input v-bind="componentField" />
          </FormControl>
          <FormMessage />
        </FormItem>
      </FormField>

      <FormField v-slot="{ componentField }" name="lastName">
        <FormItem>
          <FormLabel>Last name</FormLabel>
          <FormControl>
            <Input v-bind="componentField" />
          </FormControl>
          <FormMessage />
        </FormItem>
      </FormField>
    </div>

    <FormField v-slot="{ componentField }" name="email">
      <FormItem>
        <FormLabel>Email</FormLabel>
        <FormControl>
          <Input type="email" v-bind="componentField" />
        </FormControl>
        <FormMessage />
      </FormItem>
    </FormField>

    <div>
      <p class="text-sm font-medium mb-2">Role</p>
      <Select v-model="selectedRole">
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem
            v-for="role in roles"
            :key="role.id"
            :value="role.id"
          >
            {{ role.name }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  </form>
</template>
