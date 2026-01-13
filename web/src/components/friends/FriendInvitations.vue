<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useFriendsStore } from '@/stores/friends.store'
import { useIdentityStore } from '@/stores/identity.store'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Spinner } from '@/components/ui/spinner'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Check, X, Clock, Send, Inbox } from 'lucide-vue-next'
import type { FriendInvitation } from '@/services/friends.service'

const { t } = useI18n()

const friendsStore = useFriendsStore()
const identityStore = useIdentityStore()

const { incomingInvitations, outgoingInvitations, isLoading } = storeToRefs(friendsStore)
const { isSetupComplete } = storeToRefs(identityStore)

const hasIncoming = computed(() => incomingInvitations.value.length > 0)
const hasOutgoing = computed(() => outgoingInvitations.value.length > 0)
const hasAny = computed(() => hasIncoming.value || hasOutgoing.value)

onMounted(() => {
  if (isSetupComplete.value) {
    friendsStore.loadInvitations()
  }
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

async function handleAccept(invitation: FriendInvitation) {
  await friendsStore.accept(invitation)
}

async function handleReject(invitation: FriendInvitation) {
  await friendsStore.reject(invitation)
}

async function handleCancel(invitation: FriendInvitation) {
  await friendsStore.cancel(invitation)
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Header -->
    <div class="flex items-center gap-2">
      <Clock class="h-5 w-5" />
      <h3 class="font-semibold">{{ t('friends.invitations.title') }}</h3>
      <Badge v-if="hasIncoming" variant="secondary">
        {{ incomingInvitations.length }} {{ t('friends.invitations.incoming').toLowerCase() }}
      </Badge>
    </div>

    <!-- Loading -->
    <div v-if="isLoading" class="flex justify-center py-8">
      <Spinner class="h-6 w-6" />
    </div>

    <!-- No Identity -->
    <div
      v-else-if="!isSetupComplete"
      class="text-center text-muted-foreground py-4"
    >
      {{ t('friends.identity.setupInvitations') }}
    </div>

    <!-- Empty State -->
    <div
      v-else-if="!hasAny"
      class="text-center text-muted-foreground py-8"
    >
      {{ t('friends.invitations.noPending') }}
    </div>

    <!-- Invitations -->
    <Tabs v-else defaultValue="incoming" class="w-full">
      <TabsList class="grid w-full grid-cols-2">
        <TabsTrigger value="incoming" class="gap-2">
          <Inbox class="h-4 w-4" />
          {{ t('friends.invitations.incoming') }}
          <Badge v-if="hasIncoming" variant="secondary" class="ml-1">
            {{ incomingInvitations.length }}
          </Badge>
        </TabsTrigger>
        <TabsTrigger value="outgoing" class="gap-2">
          <Send class="h-4 w-4" />
          {{ t('friends.invitations.outgoing') }}
          <Badge v-if="hasOutgoing" variant="secondary" class="ml-1">
            {{ outgoingInvitations.length }}
          </Badge>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="incoming" class="mt-4">
        <div v-if="!hasIncoming" class="text-center text-muted-foreground py-4">
          {{ t('friends.invitations.noIncoming') }}
        </div>
        <div v-else class="flex flex-col gap-2">
          <Card
            v-for="inv in incomingInvitations"
            :key="inv.id"
            class="p-4 flex items-center justify-between gap-3"
          >
            <div class="flex items-center gap-3 min-w-0">
              <Avatar class="h-10 w-10">
                <AvatarFallback>{{ getInitials(inv.fromHandle) }}</AvatarFallback>
              </Avatar>
              <div class="min-w-0">
                <p class="font-medium truncate">{{ getAlias(inv.fromHandle) }}</p>
                <p class="text-sm text-muted-foreground truncate">
                  @{{ getDomain(inv.fromHandle) }}
                </p>
              </div>
            </div>
            <div class="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                @click="handleReject(inv)"
              >
                <X class="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                @click="handleAccept(inv)"
              >
                <Check class="h-4 w-4 mr-1" />
                {{ t('friends.accept') }}
              </Button>
            </div>
          </Card>
        </div>
      </TabsContent>

      <TabsContent value="outgoing" class="mt-4">
        <div v-if="!hasOutgoing" class="text-center text-muted-foreground py-4">
          {{ t('friends.invitations.noOutgoing') }}
        </div>
        <div v-else class="flex flex-col gap-2">
          <Card
            v-for="inv in outgoingInvitations"
            :key="inv.id"
            class="p-4 flex items-center justify-between gap-3"
          >
            <div class="flex items-center gap-3 min-w-0">
              <Avatar class="h-10 w-10">
                <AvatarFallback>{{ getInitials(inv.toHandle) }}</AvatarFallback>
              </Avatar>
              <div class="min-w-0">
                <p class="font-medium truncate">{{ getAlias(inv.toHandle) }}</p>
                <p class="text-sm text-muted-foreground truncate">
                  @{{ getDomain(inv.toHandle) }}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              @click="handleCancel(inv)"
            >
              {{ t('friends.cancel') }}
            </Button>
          </Card>
        </div>
      </TabsContent>
    </Tabs>
  </div>
</template>


