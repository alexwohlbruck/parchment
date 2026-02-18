<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import * as z from 'zod'
import { useForm, useIsFormValid } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { useAuthService } from '@/services/auth.service'
import { useAppService } from '@/services/app.service'
import { isTauri, setServerUrl, useServerUrl } from '@/lib/api'
import { useStorage } from '@vueuse/core'
import { DEFAULT_SERVER_URL } from '@/lib/constants'

const { t } = useI18n()

import { Input } from '@/components/ui/input'
import { FingerprintIcon, PlusIcon, TrashIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

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
const isLoading = ref(false)

const selectedServer = useServerUrl()

const savedServers = useStorage<string[]>('parchment-servers', [
  DEFAULT_SERVER_URL,
])

onMounted(async () => {
  try {
    // Start eager passkey authentication (conditional UI)
    // This allows browsers to show passkey autofill in the email field
    await authService.signInWithPasskey(true)
  } catch (error: any) {
    // Silently ignore abort errors - these happen when the user navigates away
    // or when the authentication ceremony is cancelled
    if (error?.name !== 'AbortError' && error?.name !== 'NotAllowedError') {
      console.error('Passkey authentication error:', error)
    }
  }
})

const emit = defineEmits({
  submit: ({ email, serverUrl }) => {
    return email.length && serverUrl.length
  },
})

async function requestOtp() {
  isLoading.value = true

  try {
    // No need for withTemporaryServerUrl since the API automatically uses the selected server
    await authService.verifyEmail(email.value)
    emit('submit', { email: email.value, serverUrl: selectedServer.value })
  } finally {
    isLoading.value = false
  }
}

// Form validation schema
const formSchema = toTypedSchema(
  z.object({
    email: z.string().email('Please enter a valid email address'),
    selectedServer: z.string().url('Please enter a valid URL'),
  }),
)

// Initialize form with validation
const { handleSubmit, setFieldValue, values } = useForm({
  validationSchema: formSchema,
  initialValues: {
    email: '',
    selectedServer: selectedServer.value,
  },
})

const isFormValid = useIsFormValid()

const handleServerSelection = async (server: string) => {
  if (server === 'add-custom') {
    const success = await addNewServer()
    if (success) {
      // addNewServer already sets the server URL via setServerUrl
      setFieldValue('selectedServer', selectedServer.value)
    }
    // No need to restore anything if canceled - the reactive ref is unchanged
  } else {
    // Simply set the server URL - the API will automatically update
    setServerUrl(server)
    setFieldValue('selectedServer', server)
  }
}

async function addNewServer(): Promise<boolean> {
  try {
    const result = (await appService.promptForm({
      title: 'Add Custom Server',
      description: 'Enter the URL of your self-hosted Parchment server',
      schema: z.object({
        url: z
          .string()
          .url('Please enter a valid URL')
          .refine(
            url => url.startsWith('https://') || url.startsWith('http://'),
            'URL must start with http:// or https://',
          ),
      }),
      initialValues: {
        url: 'http://parchment-server:5000',
      },
      fieldConfig: {
        url: {
          inputProps: {
            placeholder: 'http://parchment-server:5000',
          },
        },
      },
    })) as { url: string } | null

    if (result && result.url) {
      const url = result.url.trim()

      // Add to saved servers if not already present
      if (!savedServers.value.includes(url)) {
        savedServers.value.push(url)
      }

      // Set the new server URL - this will automatically update the API
      setServerUrl(url)
      return true
    }
    return false
  } catch (error) {
    // User cancelled the prompt
    return false
  }
}

const deleteServer = (serverToDelete: string) => {
  if (serverToDelete === DEFAULT_SERVER_URL) {
    appService.toast('Cannot delete the main server')
    return
  }

  savedServers.value = savedServers.value.filter(
    server => server !== serverToDelete,
  )

  // If the deleted server was selected, switch to main server
  if (selectedServer.value === serverToDelete) {
    setServerUrl(DEFAULT_SERVER_URL)
    setFieldValue('selectedServer', DEFAULT_SERVER_URL)
  }
}

async function startPasskeySignin() {
  if (isTauri) {
    return appService.toast('Passkey sign in not supported') // TODO: i18n
  }
  awaitingPasskey.value = true
  try {
    await authService.signInWithPasskey(false)
  } catch (error: any) {
    // Handle user cancellation gracefully
    if (error?.name === 'AbortError' || error?.name === 'NotAllowedError') {
      // User cancelled - no need to show error
      return
    }
    // Show error for other types of failures
    appService.toast('Failed to sign in with passkey')
    console.error('Passkey authentication error:', error)
  } finally {
    awaitingPasskey.value = false
  }
}

function getDisplayName(serverUrl: string): string {
  try {
    const url = new URL(serverUrl)
    // For other servers, show hostname and port if present
    return url.port ? `${url.hostname}:${url.port}` : url.hostname
  } catch {
    // Fallback to full URL if parsing fails
    return serverUrl
  }
}
</script>

<template>
  <form @submit.prevent="requestOtp()" class="space-y-4">
    <!-- Server Selection -->
    <FormField v-slot="{ componentField }" name="selectedServer">
      <FormItem>
        <FormLabel>{{ t('auth.signIn.server') }}</FormLabel>
        <FormControl>
          <input
            type="hidden"
            v-bind="componentField"
            :value="selectedServer"
          />
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="outline" class="w-full justify-between">
                <span class="truncate">{{
                  getDisplayName(selectedServer)
                }}</span>
                <svg
                  class="size-4 opacity-50 shrink-0"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              class="w-[var(--radix-dropdown-menu-trigger-width)]"
            >
              <DropdownMenuItem
                v-for="server in savedServers"
                :key="server"
                class="pl-8 pr-2"
                @click="handleServerSelection(server)"
              >
                <span class="absolute left-2 flex items-center justify-center">
                  <svg
                    v-if="selectedServer === server"
                    class="size-4"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </span>
                <span class="flex-1 truncate">{{
                  getDisplayName(server)
                }}</span>
                <Button
                  v-if="server !== DEFAULT_SERVER_URL"
                  variant="ghost"
                  size="sm"
                  class="size-6 p-0 ml-2 opacity-0 group-hover:opacity-100"
                  @click.stop="deleteServer(server)"
                >
                  <TrashIcon class="size-3" />
                </Button>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                class="gap-2"
                @click="handleServerSelection('add-custom')"
              >
                <PlusIcon class="size-4" />
                <span>{{ t('auth.server.addCustom') }}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </FormControl>
        <FormMessage />
      </FormItem>
    </FormField>

    <!-- Email Input -->
    <FormField v-slot="{ componentField }" name="email">
      <FormItem>
        <FormLabel>{{ t('auth.signIn.email') }}</FormLabel>
        <FormControl>
          <Input
            autofocus
            v-bind="componentField"
            type="email"
            :placeholder="t('auth.signIn.emailPlaceholder')"
            v-model="email"
            autocomplete="username webauthn"
          />
        </FormControl>
        <FormDescription />
      </FormItem>
    </FormField>

    <Button
      type="submit"
      class="w-full"
      :disabled="!isFormValid"
      :loading="isLoading"
    >
      {{ t('auth.signIn.sendCode') }}
    </Button>
  </form>

  <div class="flex items-center my-6" v-if="!isTauri">
    <hr class="flex-1 border-border" />
    <span class="px-4 text-xs text-muted-foreground uppercase">{{
      t('auth.signIn.or')
    }}</span>
    <hr class="flex-1 border-border" />
  </div>

  <Button
    v-if="!isTauri"
    @click="startPasskeySignin"
    :icon="FingerprintIcon"
    :loading="awaitingPasskey"
    variant="outline"
    class="w-full"
  >
    {{ t('auth.signIn.signInWithPasskey') }}
  </Button>
</template>
