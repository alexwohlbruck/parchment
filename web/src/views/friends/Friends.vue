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

function handleAddFriend() {
  if (!isSetupComplete.value) {
    recoveryDialogMode.value = 'setup'
    showRecoveryKeyDialog.value = true
  } else {
    showAddFriendDialog.value = true
  }
}

function handleSetupIdentity() {
  recoveryDialogMode.value = 'setup'
  showRecoveryKeyDialog.value = true
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
