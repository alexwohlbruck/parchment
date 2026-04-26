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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
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
import { useAppService } from '@/services/app.service'
import { useServerUrl, api } from '@/lib/api'
import {
  listSharesForResource,
  createShare,
  revokeShare,
  updateShareRole,
  createPublicLink as mintPublicLink,
  revokePublicLink as dropPublicLink,
  buildPublicLinkUrl,
  type OutgoingShare,
} from '@/services/sharing.service'
import {
  encryptForFriend,
  importPublicKey,
  buildSignableMessageV2,
  generateNonce as generateFederationNonce,
  sign as signEd25519,
} from '@/lib/federation-crypto'
import {
  upgradeCollectionToE2ee,
  downgradeCollectionToServerKey,
} from '@/lib/collection-scheme-switch'
import { rotateCollectionKey } from '@/lib/collection-rotation'
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
const appService = useAppService()
const { friends } = storeToRefs(friendsStore)
const { encryptionPrivateKey, signingPrivateKey, isSetupComplete } =
  storeToRefs(identityStore)

const searchQuery = ref('')
const shares = ref<OutgoingShare[]>([])
const loading = ref(false)
const mutating = ref(false)
// Current token for this collection; refreshed after mint/revoke so the
// UI reflects server state without a full dialog refetch.
const publicToken = ref<string | null>(props.collection.publicToken ?? null)

// Derive display fields for the owner row. The subtitle uses the
// federated handle (alias@server) — never the email. Email is a private
// contact and shouldn't be surfaced in a share UI; the federation handle
// is what other participants address the user by, and keeps the owner
// row visually consistent with friend rows below it.
const serverDomain = computed(() => {
  try {
    return new URL(serverUrl.value).host
  } catch {
    return ''
  }
})

const ownerHandle = computed(() => {
  const me = authStore.me
  if (!me?.alias) return ''
  const domain = serverDomain.value
  return domain ? `${me.alias}@${domain}` : me.alias
})

const ownerDisplayName = computed(() => {
  const me = authStore.me
  if (!me) return ''
  const full = [me.firstName, me.lastName].filter(Boolean).join(' ').trim()
  if (full) return full
  // No real name set yet — fall back to the alias (local part of the
  // federated handle). As a last resort, use the opaque user id so the
  // row still renders something.
  return me.alias ?? me.id ?? ''
})

const ownerSubtitle = computed(() => {
  // Prefer the federated handle. If the user hasn't completed identity
  // setup (no alias), render a placeholder instead of exposing the raw
  // id or email — the owner recognizes it as "finish identity setup."
  return ownerHandle.value || t('sharing.owner.identityIncomplete')
})

const ownerPicture = computed(() => authStore.me?.picture ?? null)

// Refetch shares + sync public-token state each time the dialog opens.
watch(
  () => props.open,
  async open => {
    if (!open) return
    publicToken.value = props.collection.publicToken ?? null
    await refreshShares()
  },
)

async function refreshShares() {
  loading.value = true
  try {
    const list = await listSharesForResource('collection', props.collection.id)
    // Filter out revoked rows — they shouldn't appear in the UI. The
    // server keeps them for audit but this dialog is a live access list.
    shares.value = list.filter(s => s.status !== 'revoked')
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
    name: ownerDisplayName.value,
    subtitle: ownerSubtitle.value,
    picture: ownerPicture.value,
    isOwner: true,
    role: 'owner',
  }
  const shareRows: AccessRow[] = activeShares.value.map(s => {
    // Look up the friend record so we can surface their real name +
    // avatar instead of just the raw federation handle. When a recipient
    // isn't a friend of the current viewer (shouldn't normally happen,
    // but defensive), we fall back to the handle as the name.
    const friend = friends.value.find(f => f.friendHandle === s.recipientHandle)
    const handleLocal = s.recipientHandle.split('@')[0] ?? s.recipientHandle
    return {
      key: s.id,
      name: friend?.friendName || handleLocal,
      subtitle: s.recipientHandle,
      picture: friend?.friendPicture ?? null,
      isOwner: false,
      role: s.role,
      shareId: s.id,
      handle: s.recipientHandle,
    }
  })
  return [ownerRow, ...shareRows]
})

// Friends not yet in the share list — the "Add people" dropdown.
const filteredFriends = computed(() => {
  const existingHandles = new Set(
    activeShares.value.map(s => s.recipientHandle),
  )
  const q = searchQuery.value.trim().toLowerCase()
  return friends.value.filter(f => {
    if (existingHandles.has(f.friendHandle)) return false
    if (!q) return true
    return f.friendHandle.toLowerCase().includes(q)
  })
})

const publicUrl = computed(() => {
  if (!publicToken.value) return undefined
  return buildPublicLinkUrl(serverUrl.value, publicToken.value)
})

/**
 * Does this handle live on a server other than our own? If yes, the share
 * will travel over federation and the client must sign an envelope so the
 * remote peer can verify the sender + payload haven't been tampered with.
 */
function isRemoteHandle(handle: string): boolean {
  const domain = serverDomain.value
  if (!domain) return false
  const [, recipientDomain] = handle.split('@')
  if (!recipientDomain) return false
  return recipientDomain !== domain
}

async function addShare(friendHandle: string, role: ShareRole = 'viewer') {
  if (!isSetupComplete.value || !encryptionPrivateKey.value) {
    toast.warning(t('sharing.errors.identityRequired'))
    return
  }
  const friend = friends.value.find(f => f.friendHandle === friendHandle)
  if (!friend?.friendEncryptionKey) {
    toast.error(t('sharing.errors.missingFriendKey'))
    return
  }

  mutating.value = true
  try {
    // The ECIES envelope carries everything the recipient needs to
    // render the shared collection:
    //   - the collection id + scheme (routing)
    //   - the display metadata (name, icon, iconColor, description)
    //     because the server-stored `metadataEncrypted` envelope is
    //     encrypted under Alice's personal K_m which Bob can't derive
    // So without this, Bob sees an untitled, iconless card (the bug
    // the owner reported). Metadata lives in the payload for both
    // server-key and user-e2ee schemes to keep one delivery path.
    const friendPub = importPublicKey(friend.friendEncryptionKey)
    const payload = JSON.stringify({
      collectionId: props.collection.id,
      scheme: props.collection.scheme,
      metadata: {
        name: props.collection.name,
        description: props.collection.description,
        icon: props.collection.icon,
        iconColor: props.collection.iconColor,
      },
    })
    const encrypted = encryptForFriend(
      payload,
      encryptionPrivateKey.value,
      friendPub,
      `parchment-share-collection-v1`,
    )

    // Build the v2 federation envelope when the recipient is remote. The
    // server-side forwarder sends the envelope verbatim so the peer
    // canonicalizes the SAME bytes the client signed. Without this the
    // remote peer would reject the inbound message as unsigned.
    let federationSignature: string | undefined
    let federationNonce: string | undefined
    let federationTimestamp: string | undefined
    if (isRemoteHandle(friendHandle)) {
      if (!signingPrivateKey.value) {
        toast.warning(t('sharing.errors.identityRequired'))
        return
      }
      federationNonce = generateFederationNonce()
      federationTimestamp = new Date().toISOString()
      const signable = buildSignableMessageV2({
        protocol_version: 2,
        message_type: 'RESOURCE_SHARE',
        message_version: 1,
        from: ownerHandle.value,
        to: friendHandle,
        nonce: federationNonce,
        timestamp: federationTimestamp,
        payload: {
          resourceType: 'collection',
          resourceId: props.collection.id,
          encryptedData: encrypted.ciphertext,
          nonce: encrypted.nonce,
          role,
        },
      })
      federationSignature = await signEd25519(signable, signingPrivateKey.value)
    }

    await createShare({
      recipientHandle: friendHandle,
      resourceType: 'collection',
      resourceId: props.collection.id,
      role,
      encryptedData: encrypted.ciphertext,
      nonce: encrypted.nonce,
      federationSignature,
      federationNonce,
      federationTimestamp,
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
  if (!row.shareId) return
  mutating.value = true
  try {
    await updateShareRole(row.shareId, newRole)
    await refreshShares()
    emit('changed')
  } catch (err) {
    console.error('Failed to change role', err)
    toast.error(t('sharing.errors.roleChangeFailed'))
    await refreshShares()
  } finally {
    mutating.value = false
  }
}

async function onRemove(row: AccessRow) {
  if (!row.shareId || !row.handle) return
  mutating.value = true
  try {
    // For server-key collections the server enforces access — a simple
    // revoke (hard-delete of the share row) is enough; the recipient loses
    // read access on the next request.
    //
    // For user-e2ee collections the recipient holds the collection key on
    // their device, so a row-delete alone doesn't actually revoke decrypt
    // access. We rotate the collection key: re-encrypt every point + the
    // metadata envelope under a fresh key, rewrap the new key for every
    // remaining recipient, and drop the revoked recipient's share row — all
    // in one server-side transaction. Anyone already holding the old key
    // can still decrypt ciphertext they cached locally; subsequent fetches
    // return ciphertext they can't decrypt.
    if (props.collection.scheme === 'user-e2ee') {
      if (!encryptionPrivateKey.value || !authStore.me?.id) {
        toast.warning(t('sharing.errors.identityRequired'))
        return
      }

      // Fetch the current encrypted points + remaining friends so the
      // orchestrator has everything it needs before touching the server.
      const { data: pointsResp } = await api.get(
        `/library/collections/${props.collection.id}/encrypted-points`,
      )
      const remainingShares = activeShares.value
        .filter(s => s.id !== row.shareId)
        .map(s => {
          const friend = friends.value.find(
            f => f.friendHandle === s.recipientHandle,
          )
          if (!friend?.friendEncryptionKey) return null
          return {
            id: s.id,
            recipientHandle: s.recipientHandle,
            recipientEncryptionKey: friend.friendEncryptionKey,
          }
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)

      await rotateCollectionKey({
        collection: props.collection,
        ownerUserId: authStore.me.id,
        currentPoints: (pointsResp.points ?? []) as Array<{
          id: string
          encryptedData: string
          nonce: string
        }>,
        remainingShares,
        revokeRecipientHandles: [row.handle],
        ownerEncryptionPrivateKey: encryptionPrivateKey.value,
      })
    } else {
      await revokeShare(row.shareId)
    }
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

/**
 * Trigger the bidirectional scheme switch.
 *
 * Currently this only surfaces via the "Switch to server-stored" affordance
 * inside the e2ee General Access panel, meaning it's always a DOWNGRADE
 * direction (user-e2ee → server-key). An UPGRADE affordance lives on the
 * server-key panel; both converge here.
 */
async function onRequestSchemeSwitch() {
  if (!isSetupComplete.value || !encryptionPrivateKey.value) {
    toast.warning(t('sharing.errors.identityRequired'))
    return
  }

  const ownerUserId = authStore.me?.id
  if (!ownerUserId) return

  const goingToE2ee = props.collection.scheme === 'server-key'

  // Both directions are transactional on the server and can't be trivially
  // undone without running the reverse migration. The downgrade is louder
  // (trust escalation to the server) but both deserve a confirm step.
  const confirmed = await appService.confirm({
    title: goingToE2ee
      ? t('sharing.schemeSwitch.upgradeConfirm.title')
      : t('sharing.schemeSwitch.downgradeConfirm.title'),
    description: goingToE2ee
      ? t('sharing.schemeSwitch.upgradeConfirm.description')
      : t('sharing.schemeSwitch.downgradeConfirm.description'),
    continueText: goingToE2ee
      ? t('sharing.schemeSwitch.upgradeConfirm.continueText')
      : t('sharing.schemeSwitch.downgradeConfirm.continueText'),
    destructive: !goingToE2ee,
  })
  if (!confirmed) return

  mutating.value = true
  try {
    // Fetch the current bookmarks or encrypted points so the orchestrator
    // can transform them under the new scheme. Both endpoints are
    // idempotent reads — fine to call even on a large collection.
    const { data: detail } = await api.get(
      `/library/collections/${props.collection.id}`,
    )

    // Map the existing shares into the shape the orchestrator expects.
    // Recipient public keys come from the friends store — every remaining
    // friend-share must have the recipient's long-term X25519 pub cached.
    const remainingShares = activeShares.value
      .map(s => {
        const friend = friends.value.find(
          f => f.friendHandle === s.recipientHandle,
        )
        if (!friend?.friendEncryptionKey) return null
        return {
          id: s.id,
          recipientHandle: s.recipientHandle,
          recipientEncryptionKey: friend.friendEncryptionKey,
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)

    if (goingToE2ee) {
      await upgradeCollectionToE2ee({
        collection: props.collection,
        ownerUserId,
        currentBookmarks: detail.bookmarks ?? [],
        remainingShares,
        ownerEncryptionPrivateKey: encryptionPrivateKey.value,
      })
    } else {
      const { data: pointsResp } = await api.get(
        `/library/collections/${props.collection.id}/encrypted-points`,
      )
      await downgradeCollectionToServerKey({
        collection: props.collection,
        ownerUserId,
        currentPoints: pointsResp.points ?? [],
        remainingShares,
        ownerEncryptionPrivateKey: encryptionPrivateKey.value,
      })
    }

    toast.success(t('sharing.schemeSwitch.success'))
    emit('changed')
    // The collection passed in as a prop is now stale (scheme flipped).
    // Close the dialog — the parent will refetch on the `changed` event.
    emit('update:open', false)
  } catch (err) {
    console.error('Scheme switch failed', err)
    toast.error(t('sharing.schemeSwitch.failed'))
  } finally {
    mutating.value = false
  }
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
          <Avatar class="size-7 shrink-0">
            <AvatarImage
              v-if="friend.friendPicture"
              :src="friend.friendPicture"
            />
            <AvatarFallback>{{
              (friend.friendName || friend.friendHandle)
                .slice(0, 2)
                .toUpperCase()
            }}</AvatarFallback>
          </Avatar>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium truncate">
              {{ friend.friendName || friend.friendHandle.split('@')[0] }}
            </div>
            <div class="text-xs text-muted-foreground truncate">
              {{ friend.friendHandle }}
            </div>
          </div>
          <span class="text-xs text-muted-foreground ml-auto shrink-0">
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
