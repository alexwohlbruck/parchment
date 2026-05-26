<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useFriendsStore } from '@/stores/friends.store'
import { useIdentityStore } from '@/stores/identity.store'
import {
  FriendsList,
  FriendInvitations,
  AddFriendDialog,
  RecoveryKeyDialog,
} from '@/components/friends'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { UserPlusIcon } from 'lucide-vue-next'
import PanelLayout from '@/components/layouts/PanelLayout.vue'
import { useAuthService } from '@/services/auth.service'
import { PermissionId } from '@/types/auth.types'
import UpgradeBanner from '@/components/subscription/UpgradeBanner.vue'

const authService = useAuthService()
const canAccessFriends = computed(() => authService.hasPermission(PermissionId.SOCIAL_READ))

const friendsStore = useFriendsStore()
const identityStore = useIdentityStore()

const { isSetupComplete, needsImport, handle } = storeToRefs(identityStore)
const { pendingIncomingCount } = storeToRefs(friendsStore)

const showAddFriendDialog = ref(false)
const showRecoveryKeyDialog = ref(false)
const recoveryDialogMode = ref<'setup' | 'import'>('setup')

// Friend location polling is now handled globally by useFriendLocationsLayer
// which watches the Friends layer visibility in the layers system

onMounted(async () => {
  await identityStore.initialize()

  if (needsImport.value) {
    recoveryDialogMode.value = 'import'
    showRecoveryKeyDialog.value = true
  } else if (!isSetupComplete.value) {
    recoveryDialogMode.value = 'setup'
    showRecoveryKeyDialog.value = true
  } else {
    await friendsStore.loadAll()
  }
})

function handleSetupComplete() {
  friendsStore.loadAll()
}

// Pick the right dialog mode based on what the server knows about
// this account. If the server already has identity keys (i.e. another
// device set up this account before), the right flow is to IMPORT the
// existing seed here — showing a setup dialog that mints a fresh seed
// would leave the server's old identity orphaned. Without server-side
// keys, the only path is to create a new identity.
function openIdentityDialog() {
  recoveryDialogMode.value = needsImport.value ? 'import' : 'setup'
  showRecoveryKeyDialog.value = true
}

function handleAddFriend() {
  if (!isSetupComplete.value) {
    openIdentityDialog()
  } else {
    showAddFriendDialog.value = true
  }
}

function handleSetupIdentity() {
  openIdentityDialog()
}
</script>

<template>
  <PanelLayout>
    <template v-if="canAccessFriends">
      <h1 class="text-2xl font-semibold mb-3">Friends</h1>
      <Tabs default-value="friends" class="flex-1 flex flex-col">
        <div class="-mx-3 px-3 flex items-end border-b border-border" style="width: calc(100% + 1.5rem)">
          <TabsList variant="linear" class="border-b-0">
            <TabsTrigger value="friends" variant="linear">
              Friends
            </TabsTrigger>
            <TabsTrigger value="invitations" variant="linear" :count="pendingIncomingCount || null">
              Invitations
            </TabsTrigger>
          </TabsList>
          <div class="flex items-center ml-auto pb-1">
            <Button variant="ghost" size="icon" class="size-7" @click="handleAddFriend">
              <UserPlusIcon class="size-4" />
            </Button>
          </div>
        </div>

        <TabsContent value="friends" class="flex-1 pt-3">
          <FriendsList
            @add-friend="handleAddFriend"
            @setup-identity="handleSetupIdentity"
          />
        </TabsContent>

        <TabsContent value="invitations" class="flex-1 pt-3">
          <FriendInvitations />
        </TabsContent>
      </Tabs>

      <!-- Dialogs -->
      <AddFriendDialog v-model:open="showAddFriendDialog" />
      <RecoveryKeyDialog
        v-model:open="showRecoveryKeyDialog"
        :mode="recoveryDialogMode"
        @complete="handleSetupComplete"
      />
    </template>
    <UpgradeBanner v-else feature="friends" required-tier="basic" />
  </PanelLayout>
</template>
