<script setup lang="ts">
import { ref, onMounted } from 'vue'
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
import { Users, Inbox, AtSign } from 'lucide-vue-next'
import { Card, CardContent } from '@/components/ui/card'
import { Code } from '@/components/ui/code'
import { Button } from '@/components/ui/button'
import CopyButton from '@/components/CopyButton.vue'
import { useRouter } from 'vue-router'
import PanelLayout from '@/components/layouts/PanelLayout.vue'

const friendsStore = useFriendsStore()
const identityStore = useIdentityStore()
const router = useRouter()

const { isSetupComplete, needsImport, handle } = storeToRefs(identityStore)

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
    <h1 class="text-2xl font-semibold mb-3">Friends</h1>
    <Tabs default-value="friends" class="flex-1 flex flex-col gap-4">
      <TabsList class="w-full">
        <TabsTrigger value="friends" class="flex-1 gap-2">
          <Users class="h-4 w-4" />
          Friends
        </TabsTrigger>
        <TabsTrigger value="invitations" class="flex-1 gap-2">
          <Inbox class="h-4 w-4" />
          Invitations
        </TabsTrigger>
      </TabsList>

      <TabsContent value="friends" class="flex-1 mt-4">
        <FriendsList
          @add-friend="handleAddFriend"
          @setup-identity="handleSetupIdentity"
        />
      </TabsContent>

      <TabsContent value="invitations" class="flex-1 mt-4">
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
  </PanelLayout>
</template>
