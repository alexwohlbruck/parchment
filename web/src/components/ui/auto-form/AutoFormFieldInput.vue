<script setup lang="ts">
import { computed, ref } from 'vue'
import AutoFormLabel from './AutoFormLabel.vue'
import { beautifyObjectName } from './utils'
import type { FieldProps } from './interface'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Eye, EyeOff } from 'lucide-vue-next'

const props = defineProps<FieldProps>()

const inputComponent = computed(() =>
  props.config?.component === 'textarea' ? Textarea : Input,
)

const showPassword = ref(false)

// List of field names that should be treated as sensitive/password fields
const sensitiveFieldNames = [
  'accesstoken',
  'access_token',
  'apikey',
  'api_key',
  'secret',
  'clientsecret',
  'client_secret',
  'password',
  'token',
  'key',
  'credentials',
  'auth',
  'bearer',
]

// Determine if this field should be a password field
const shouldBePasswordField = computed(() => {
  // Check if explicitly set in config
  if (props.config?.inputProps?.type) {
    return props.config.inputProps.type === 'password'
  }

  // Auto-detect based on field name
  const fieldNameLower = (props.fieldName || '').toLowerCase()
  return sensitiveFieldNames.some(sensitiveName =>
    fieldNameLower.includes(sensitiveName),
  )
})

const inputType = computed(() => {
  if (shouldBePasswordField.value) {
    return showPassword.value ? 'text' : 'password'
  }
  return props.config?.inputProps?.type || 'text'
})

function togglePasswordVisibility() {
  showPassword.value = !showPassword.value
}
</script>

<template>
  <FormField v-slot="slotProps" :name="fieldName">
    <FormItem v-bind="$attrs">
      <AutoFormLabel v-if="!config?.hideLabel" :required="required">
        {{ config?.label || beautifyObjectName(label ?? fieldName) }}
      </AutoFormLabel>
      <FormControl>
        <slot v-bind="slotProps">
          <div class="relative">
            <component
              :is="inputComponent"
              :type="inputType"
              v-bind="{ ...slotProps.componentField, ...config?.inputProps }"
              :disabled="disabled"
              :class="shouldBePasswordField ? 'pr-10' : ''"
            />
            <Button
              v-if="shouldBePasswordField"
              type="button"
              variant="ghost"
              size="icon-sm"
              class="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 text-muted-foreground hover:text-foreground"
              @click="togglePasswordVisibility"
              :title="showPassword ? 'Hide password' : 'Show password'"
            >
              <Eye v-if="!showPassword" class="h-4 w-4" />
              <EyeOff v-else class="h-4 w-4" />
            </Button>
          </div>
        </slot>
      </FormControl>
      <FormDescription v-if="config?.description">
        {{ config.description }}
      </FormDescription>
      <FormMessage />
    </FormItem>
  </FormField>
</template>
