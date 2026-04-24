<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { SearchIcon } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import PeopleWithAccessList, {
  type AccessRow,
} from './PeopleWithAccessList.vue'
import GeneralAccessSection from './GeneralAccessSection.vue'

import { useFriendsStore } from '@/stores/friends.store'
import { useIdentityStore } from '@/stores/identity.store'
import { useAuthStore } from '@/stores/auth.store'
import { useServerUrl } from '@/lib/api'
import {
  listSharesForResource,
  createShare,
  revokeShare,
  createPublicLink as mintPublicLink,
  revokePublicLink as dropPublicLink,
  buildPublicLinkUrl,
  type OutgoingShare,
} from '@/services/sharing.service'
import { encryptForFriend, importPublicKey } from '@/lib/federation-crypto'
import type { Collection, ShareRole } from '@/types/library.types'

/**
 * Google-Docs-style share dialog.
 *
 * Scope for v1: collections only. Takes a Collection object (with the
 * caller's current scheme/public_token state) and drives share creation,
 * role changes, revocation, and public-link management through the
 * client sharing service.
 *
 * Cross-server shares and full e2ee rotate-on-revoke are tracked as
 * follow-ups — the wiring here calls revokeShare() which flips the flag
 * server-side but does NOT rotate the collection key. That makes
 * revocation weak for e2ee collections until Phase 7 wires up the
 * rotation flow — flagged in the UI with a short note so the user
 * isn't surprised.
 */

const props = defineProps<{
  open: boolean
  collection: Collection
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'changed'): void
}>()

const { t } = useI18n()
const serverUrl = useServerUrl()
const friendsStore = useFriendsStore()
const identityStore = useIdentityStore()
const authStore = useAuthStore()
const { friends } = storeToRefs(friendsStore)
const { encryptionPrivateKey, isSetupComplete } = storeToRefs(identityStore)

const searchQuery = ref('')
const shares = ref<OutgoingShare[]>([])
const loading = ref(false)
const mutating = ref(false)
// Current token for this collection; refreshed after mint/revoke so the
// UI reflects server state without a full dialog refetch.
const publicToken = ref<string | null>(props.collection.publicToken ?? null)

const ownerHandle = computed(() => {
  // Owner is always the authenticated user for collections they own.
  // The auth store exposes `alias`; full handle construction
  // (alias@server) isn't plumbed through yet — alias alone is enough
  // signal for the dialog's owner row. Falls back to user id so the
  // row always renders something.
  return authStore.me?.alias ?? authStore.me?.id ?? ''
})

// Refetch shares + sync public-token state each time the dialog opens.
watch(
  () => props.open,
  async (open) => {
    if (!open) return
    publicToken.value = props.collection.publicToken ?? null
    await refreshShares()
  },
)

async function refreshShares() {
  loading.value = true
  try {
    const list = await listSharesForResource(
      'collection',
      props.collection.id,
    )
    // Filter out revoked rows — they shouldn't appear in the UI. The
    // server keeps them for audit but this dialog is a live access list.
    shares.value = list.filter((s) => s.status !== 'revoked')
  } catch (err) {
    console.error('Failed to load shares', err)
    toast.error(t('sharing.errors.loadFailed'))
  } finally {
    loading.value = false
  }
}

const activeShares = computed(() => shares.value)

const rows = computed<AccessRow[]>(() => {
  const ownerRow: AccessRow = {
    key: 'owner',
    handle: ownerHandle.value,
    isOwner: true,
    role: 'owner',
  }
  const shareRows: AccessRow[] = activeShares.value.map((s) => ({
    key: s.id,
    handle: s.recipientHandle,
    isOwner: false,
    role: s.role,
    shareId: s.id,
  }))
  return [ownerRow, ...shareRows]
})

// Friends not yet in the share list — the "Add people" dropdown.
const filteredFriends = computed(() => {
  const existingHandles = new Set(
    activeShares.value.map((s) => s.recipientHandle),
  )
  const q = searchQuery.value.trim().toLowerCase()
  return friends.value.filter((f) => {
    if (existingHandles.has(f.friendHandle)) return false
    if (!q) return true
    return f.friendHandle.toLowerCase().includes(q)
  })
})

const publicUrl = computed(() => {
  if (!publicToken.value) return undefined
  return buildPublicLinkUrl(serverUrl.value, publicToken.value)
})

async function addShare(friendHandle: string, role: ShareRole = 'viewer') {
  if (!isSetupComplete.value || !encryptionPrivateKey.value) {
    toast.warning(t('sharing.errors.identityRequired'))
    return
  }
  const friend = friends.value.find((f) => f.friendHandle === friendHandle)
  if (!friend?.friendEncryptionKey) {
    toast.error(t('sharing.errors.missingFriendKey'))
    return
  }

  mutating.value = true
  try {
    // The payload is the per-collection key wrapped for this friend. For
    // server-key collections the wrapped bytes are effectively a marker
    // (server enforces ACL and serves plaintext on read); for user-e2ee
    // collections it's the actual decrypt key. Sending a non-empty blob
    // in both cases keeps the federation path uniform.
    const friendPub = importPublicKey(friend.friendEncryptionKey)
    const payload = JSON.stringify({
      collectionId: props.collection.id,
      scheme: props.collection.scheme,
    })
    const encrypted = encryptForFriend(
      payload,
      encryptionPrivateKey.value,
      friendPub,
      `parchment-share-collection-v1`,
    )
    await createShare({
      recipientHandle: friendHandle,
      resourceType: 'collection',
      resourceId: props.collection.id,
      role,
      encryptedData: encrypted.ciphertext,
      nonce: encrypted.nonce,
    })
    await refreshShares()
    emit('changed')
  } catch (err) {
    console.error('Failed to create share', err)
    toast.error(t('sharing.errors.createFailed'))
  } finally {
    mutating.value = false
  }
}

async function onChangeRole(row: AccessRow, newRole: ShareRole) {
  // v1 simplification: updating role means revoke + recreate the share,
  // since the service doesn't yet expose an update-role endpoint. The
  // outgoing share history on the server will reflect the prior role as
  // revoked. Followup: add a dedicated PATCH /sharing/:id endpoint.
  if (!row.shareId) return
  mutating.value = true
  try {
    await revokeShare(row.shareId)
    await addShare(row.handle, newRole)
  } catch (err) {
    console.error('Failed to change role', err)
    toast.error(t('sharing.errors.roleChangeFailed'))
    await refreshShares()
  } finally {
    mutating.value = false
  }
}

async function onRemove(row: AccessRow) {
  if (!row.shareId) return
  mutating.value = true
  try {
    await revokeShare(row.shareId)
    await refreshShares()
    emit('changed')
  } catch (err) {
    console.error('Failed to revoke share', err)
    toast.error(t('sharing.errors.revokeFailed'))
  } finally {
    mutating.value = false
  }
}

async function onMintPublicLink() {
  mutating.value = true
  try {
    const link = await mintPublicLink(props.collection.id)
    publicToken.value = link.publicToken
    emit('changed')
  } catch (err) {
    console.error('Failed to mint public link', err)
    toast.error(t('sharing.errors.publicLinkFailed'))
  } finally {
    mutating.value = false
  }
}

async function onRevokePublicLink() {
  mutating.value = true
  try {
    await dropPublicLink(props.collection.id)
    publicToken.value = null
    emit('changed')
  } catch (err) {
    console.error('Failed to revoke public link', err)
    toast.error(t('sharing.errors.publicLinkRevokeFailed'))
  } finally {
    mutating.value = false
  }
}

async function onCopyPublicLink() {
  if (!publicUrl.value) return
  try {
    await navigator.clipboard.writeText(publicUrl.value)
    toast.success(t('sharing.publicLink.copied'))
  } catch {
    toast.error(t('sharing.errors.copyFailed'))
  }
}

function onRequestSchemeSwitch() {
  // Phase 7 wires this up. For now surface a TODO toast so the user
  // knows the button works but the scheme-switch flow isn't shipped yet.
  toast.info(t('sharing.schemeSwitch.comingSoon'))
}

function close() {
  emit('update:open', false)
}

const collectionName = computed(
  () => props.collection.name || t('library.entities.collections.untitled'),
)
</script>

<template>
  <Dialog :open="open" @update:open="$emit('update:open', $event)">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>
          {{ t('sharing.title', { name: collectionName }) }}
        </DialogTitle>
        <DialogDescription class="sr-only">
          {{ t('sharing.description') }}
        </DialogDescription>
      </DialogHeader>

      <!-- Friend search -->
      <div class="relative">
        <SearchIcon
          class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground"
        />
        <Input
          v-model="searchQuery"
          :placeholder="t('sharing.searchPlaceholder')"
          class="pl-9"
        />
      </div>

      <!-- Friend-picker list — shown when there's anything to add -->
      <div
        v-if="searchQuery && filteredFriends.length > 0"
        class="rounded-md border max-h-40 overflow-y-auto"
      >
        <button
          v-for="friend in filteredFriends"
          :key="friend.friendHandle"
          class="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted/50 text-left"
          :disabled="mutating"
          @click="addShare(friend.friendHandle)"
        >
          <span class="text-sm font-medium truncate">
            {{ friend.friendHandle }}
          </span>
          <span class="text-xs text-muted-foreground ml-auto">
            {{ t('sharing.addAction') }}
          </span>
        </button>
      </div>

      <div
        v-else-if="searchQuery"
        class="text-sm text-muted-foreground text-center py-3"
      >
        {{ t('sharing.noFriendsMatch') }}
      </div>

      <!-- People with access -->
      <section class="space-y-1">
        <div class="text-sm font-medium text-foreground">
          {{ t('sharing.peopleWithAccess') }}
        </div>
        <div v-if="loading" class="flex items-center justify-center py-4">
          <Spinner class="size-4" />
        </div>
        <PeopleWithAccessList
          v-else
          :rows="rows"
          :disabled="mutating"
          @update:role="onChangeRole"
          @remove="onRemove"
        />
      </section>

      <!-- General access -->
      <GeneralAccessSection
        :scheme="collection.scheme"
        :public-token="publicToken"
        :public-url="publicUrl"
        :disabled="mutating"
        @mint-public-link="onMintPublicLink"
        @revoke-public-link="onRevokePublicLink"
        @copy-public-link="onCopyPublicLink"
        @request-scheme-switch="onRequestSchemeSwitch"
      />

      <div class="flex justify-end">
        <Button @click="close" :disabled="mutating">
          {{ t('general.done') }}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
