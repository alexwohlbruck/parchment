<script setup lang="ts">
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useFriendsStore } from '@/stores/friends.store'
import { useIdentityStore } from '@/stores/identity.store'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Card } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { UserPlus, Search, AlertCircle, Check, ExternalLink } from 'lucide-vue-next'
import type { RemoteUserInfo } from '@/services/friends.service'

const { t } = useI18n()

interface Props {
  open: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const friendsStore = useFriendsStore()
const identityStore = useIdentityStore()

const { domain } = storeToRefs(identityStore)

const handleInput = ref('')
const isSearching = ref(false)
const isSending = ref(false)
const resolvedUser = ref<RemoteUserInfo | null>(null)
const error = ref<string | null>(null)
const success = ref(false)

const isOpen = computed({
  get: () => props.open,
  set: (value) => emit('update:open', value),
})

const placeholder = computed(() => {
  return `username@${domain.value || 'server.com'}`
})

const isValidHandle = computed(() => {
  const parts = handleInput.value.split('@')
  if (parts.length !== 2) return false
  const [alias, domain] = parts
  return alias.length >= 3 && domain.length >= 3
})

function getAlias(handle: string) {
  return handle.split('@')[0]
}

function getDomain(handle: string) {
  return handle.split('@')[1]
}

function getInitials(handle: string) {
  return getAlias(handle).slice(0, 2).toUpperCase()
}

async function handleSearch() {
  if (!isValidHandle.value) return

  error.value = null
  resolvedUser.value = null
  isSearching.value = true

  try {
    const user = await friendsStore.resolve(handleInput.value)
    if (user) {
      resolvedUser.value = user
    } else {
      error.value = t('friends.addDialog.userNotFound')
    }
  } catch (e) {
    error.value = t('friends.addDialog.lookupFailed')
  } finally {
    isSearching.value = false
  }
}

async function handleSendInvitation() {
  if (!resolvedUser.value) return

  isSending.value = true
  error.value = null

  try {
    const result = await friendsStore.invite(resolvedUser.value.handle)
    
    if (result.success) {
      success.value = true
      setTimeout(() => {
        isOpen.value = false
        resetForm()
      }, 1500)
    } else {
      error.value = result.error || t('friends.addDialog.sendFailed')
    }
  } finally {
    isSending.value = false
  }
}

function resetForm() {
  handleInput.value = ''
  resolvedUser.value = null
  error.value = null
  success.value = false
}

function handleClose() {
  isOpen.value = false
  resetForm()
}
</script>

<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <UserPlus class="h-5 w-5" />
          {{ t('friends.addDialog.title') }}
        </DialogTitle>
        <DialogDescription>
          {{ t('friends.addDialog.description') }}
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-4 py-4">
        <!-- Handle Input -->
        <div class="flex flex-col gap-2">
          <Label for="handle">{{ t('friends.addDialog.handleLabel') }}</Label>
          <div class="flex gap-2">
            <Input
              id="handle"
              v-model="handleInput"
              :placeholder="placeholder"
              :disabled="isSearching || success"
              @keyup.enter="handleSearch"
            />
            <Button
              variant="outline"
              :disabled="!isValidHandle || isSearching || success"
              @click="handleSearch"
            >
              <Spinner v-if="isSearching" class="h-4 w-4" />
              <Search v-else class="h-4 w-4" />
            </Button>
          </div>
          <p class="text-xs text-muted-foreground">
            {{ t('friends.addDialog.formatHint') }}
          </p>
        </div>

        <!-- Error -->
        <Alert v-if="error" variant="destructive">
          <AlertCircle class="h-4 w-4" />
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <!-- Success -->
        <Alert v-if="success" class="border-green-500 text-green-600">
          <Check class="h-4 w-4" />
          <AlertDescription>{{ t('friends.addDialog.invitationSent') }}</AlertDescription>
        </Alert>

        <!-- Resolved User Preview -->
        <Card v-if="resolvedUser && !success" class="p-4">
          <div class="flex items-center gap-3">
            <Avatar class="h-12 w-12">
              <AvatarFallback>{{ getInitials(resolvedUser.handle) }}</AvatarFallback>
            </Avatar>
            <div class="flex-1 min-w-0">
              <p class="font-medium">{{ getAlias(resolvedUser.handle) }}</p>
              <p class="text-sm text-muted-foreground flex items-center gap-1">
                @{{ getDomain(resolvedUser.handle) }}
                <ExternalLink
                  v-if="getDomain(resolvedUser.handle) !== domain"
                  class="h-3 w-3"
                />
              </p>
            </div>
            <Button
              :disabled="isSending"
              @click="handleSendInvitation"
            >
              <Spinner v-if="isSending" class="h-4 w-4 mr-2" />
              <UserPlus v-else class="h-4 w-4 mr-2" />
              {{ t('friends.sendInvite') }}
            </Button>
          </div>
        </Card>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="handleClose">
          {{ success ? t('friends.done') : t('friends.cancel') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>


