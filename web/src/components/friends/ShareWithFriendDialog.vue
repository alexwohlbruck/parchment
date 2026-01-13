<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useFriendsStore } from '@/stores/friends.store'
import { useIdentityStore } from '@/stores/identity.store'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import { Share2, Lock, Users, Check } from 'lucide-vue-next'
import { api } from '@/lib/api'
import { encryptForFriend, importPublicKey } from '@/lib/federation-crypto'
import { toast } from 'vue-sonner'

const { t } = useI18n()

type ResourceType = 'collection' | 'route' | 'map' | 'layer'

interface Props {
  open: boolean
  resourceType: ResourceType
  resourceId: string
  resourceName?: string
  resourceData?: object // Data to encrypt and share
}

const props = withDefaults(defineProps<Props>(), {
  resourceName: 'Resource',
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  shared: [friendHandles: string[]]
}>()

const friendsStore = useFriendsStore()
const identityStore = useIdentityStore()

const { friends } = storeToRefs(friendsStore)
const { encryptionPrivateKey, isSetupComplete } = storeToRefs(identityStore)

const isLoading = ref(false)
const selectedFriends = ref<Set<string>>(new Set())
const existingShares = ref<Set<string>>(new Set())

// Load existing shares when dialog opens
watch(
  () => props.open,
  async open => {
    if (open) {
      await loadExistingShares()
    } else {
      selectedFriends.value = new Set()
    }
  },
)

async function loadExistingShares() {
  try {
    const { data } = await api.get(
      `/sharing/outgoing/${props.resourceType}/${props.resourceId}`,
    )
    existingShares.value = new Set(
      data.shares
        .filter((s: any) => s.status !== 'revoked')
        .map((s: any) => s.recipientHandle),
    )
  } catch (error) {
    console.error('Failed to load existing shares:', error)
  }
}

function toggleFriend(handle: string) {
  if (selectedFriends.value.has(handle)) {
    selectedFriends.value.delete(handle)
  } else {
    selectedFriends.value.add(handle)
  }
  selectedFriends.value = new Set(selectedFriends.value) // Trigger reactivity
}

function isAlreadyShared(handle: string): boolean {
  return existingShares.value.has(handle)
}

function getFriendInitials(handle: string): string {
  return handle.split('@')[0].substring(0, 2).toUpperCase()
}

function getFriendDisplayName(handle: string): string {
  return handle.split('@')[0]
}

const canShare = computed(() => {
  return (
    isSetupComplete.value &&
    encryptionPrivateKey.value &&
    selectedFriends.value.size > 0 &&
    props.resourceData
  )
})

async function handleShare() {
  if (!canShare.value || !props.resourceData || !encryptionPrivateKey.value) {
    return
  }

  isLoading.value = true

  try {
    const sharedWith: string[] = []
    const dataJson = JSON.stringify(props.resourceData)

    for (const friendHandle of selectedFriends.value) {
      const friend = friends.value.find(f => f.friendHandle === friendHandle)
      if (!friend?.friendEncryptionKey) {
        console.warn(`Missing encryption key for ${friendHandle}`)
        continue
      }

      try {
        // Encrypt data for this friend
        const friendPublicKey = importPublicKey(friend.friendEncryptionKey)
        const encrypted = encryptForFriend(
          dataJson,
          encryptionPrivateKey.value,
          friendPublicKey,
          `parchment-share-${props.resourceType}-v1`,
        )

        // Send to server
        await api.post('/sharing', {
          recipientHandle: friendHandle,
          resourceType: props.resourceType,
          resourceId: props.resourceId,
          encryptedData: encrypted.ciphertext,
          nonce: encrypted.nonce,
        })

        sharedWith.push(friendHandle)
      } catch (error) {
        console.error(`Failed to share with ${friendHandle}:`, error)
      }
    }

    if (sharedWith.length > 0) {
      toast.success(`Shared with ${sharedWith.length} friend(s)`)
      emit('shared', sharedWith)
    }

    emit('update:open', false)
  } catch (error) {
    console.error('Share failed:', error)
    toast.error('Failed to share')
  } finally {
    isLoading.value = false
  }
}

function close() {
  emit('update:open', false)
}
</script>

<template>
  <Dialog :open="open" @update:open="$emit('update:open', $event)">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <Share2 class="h-5 w-5" />
          {{ t('friends.shareDialog.title', { name: resourceName }) }}
        </DialogTitle>
        <DialogDescription>
          {{ t('friends.shareDialog.description', { type: resourceType }) }}
        </DialogDescription>
      </DialogHeader>

      <div class="py-4">
        <!-- Not setup warning -->
        <Alert v-if="!isSetupComplete" variant="destructive" class="mb-4">
          <AlertDescription>
            {{ t('friends.shareDialog.identityRequired') }}
          </AlertDescription>
        </Alert>

        <!-- No friends -->
        <div
          v-else-if="friends.length === 0"
          class="text-center py-8 text-muted-foreground"
        >
          <Users class="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>{{ t('friends.shareDialog.noFriends') }}</p>
        </div>

        <!-- Friends list -->
        <div v-else class="space-y-2 max-h-64 overflow-y-auto">
          <div
            v-for="friend in friends"
            :key="friend.friendHandle"
            class="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer"
            :class="{
              'opacity-50': isAlreadyShared(friend.friendHandle),
              'ring-2 ring-primary': selectedFriends.has(friend.friendHandle),
            }"
            @click="
              !isAlreadyShared(friend.friendHandle) &&
                toggleFriend(friend.friendHandle)
            "
          >
            <Checkbox
              :checked="
                selectedFriends.has(friend.friendHandle) ||
                isAlreadyShared(friend.friendHandle)
              "
              :disabled="isAlreadyShared(friend.friendHandle)"
              @click.stop
              @update:checked="toggleFriend(friend.friendHandle)"
            />

            <Avatar class="h-10 w-10">
              <AvatarFallback>
                {{ getFriendInitials(friend.friendHandle) }}
              </AvatarFallback>
            </Avatar>

            <div class="flex-1">
              <p class="font-medium">
                {{ getFriendDisplayName(friend.friendHandle) }}
              </p>
              <p class="text-xs text-muted-foreground">
                {{ friend.friendHandle }}
              </p>
            </div>

            <div
              v-if="isAlreadyShared(friend.friendHandle)"
              class="flex items-center gap-1 text-xs text-green-600"
            >
              <Check class="h-4 w-4" />
              {{ t('friends.shareDialog.alreadyShared') }}
            </div>
          </div>
        </div>

        <!-- E2EE indicator -->
        <div
          class="flex items-center gap-2 mt-4 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 text-sm"
        >
          <Lock class="h-4 w-4 text-green-600" />
          <span class="text-green-700 dark:text-green-400">
            {{ t('friends.shareDialog.e2eeNotice') }}
          </span>
        </div>
      </div>

      <!-- Actions -->
      <div class="flex justify-end gap-2">
        <Button variant="outline" @click="close" :disabled="isLoading">
          {{ t('general.cancel') }}
        </Button>
        <Button @click="handleShare" :disabled="!canShare || isLoading">
          <Spinner v-if="isLoading" class="mr-2 h-4 w-4" />
          {{
            t('friends.shareDialog.shareButton', {
              count: selectedFriends.size,
            })
          }}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
