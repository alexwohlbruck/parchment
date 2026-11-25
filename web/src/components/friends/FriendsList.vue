<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useFriendsStore } from '@/stores/friends.store'
import { useIdentityStore } from '@/stores/identity.store'
import { useLocationService } from '@/services/location.service'
import { useLocationShare } from '@/composables/friends/useLocationShare'
import { useLocationClock } from '@/composables/friends/useLocationClock'
import { isShareActive } from '@server/lib/location-share'
import type { LocationShareState, ShareDuration } from '@/lib/friends/share-duration'
import { useFriendLocations } from '@/composables/friends/useFriendLocations'
import { useRemoveFriend } from '@/composables/friends/useRemoveFriend'
import { useSyncFriendKeys } from '@/composables/friends/useSyncFriendKeys'
import { appEventBus } from '@/lib/event-bus'
import FriendCard from './FriendCard.vue'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { UserPlus, Users, Shield } from 'lucide-vue-next'
import Alert from '@/components/ui/alert/Alert.vue'
import { TransitionFade } from '@morev/vue-transitions'

const { t } = useI18n()

const friendsStore = useFriendsStore()
const { removeFriend } = useRemoveFriend()
const identityStore = useIdentityStore()
const locationService = useLocationService()
const locationShare = useLocationShare()
const now = useLocationClock()
const friendLocations = useFriendLocations()

const { friends, isLoading } = storeToRefs(friendsStore)
const { isSetupComplete, needsImport } = storeToRefs(identityStore)

const emit = defineEmits<{
  addFriend: []
  setupIdentity: []
}>()

const locationConfigs = reactive<Record<string, LocationShareState>>({})
const locationLoading = ref(true)
const locationSaving = locationShare.savingHandle

const isEmpty = computed(() => friends.value.length === 0 && !isLoading.value)

// Load location configs when friends list changes
watch(
  friends,
  async newFriends => {
    if (newFriends.length > 0 && isSetupComplete.value) {
      await loadLocationConfigs()
    }
  },
  { immediate: true },
)

async function loadLocationConfigs() {
  try {
    const existingConfigs = await locationService.getE2eeConfigs()

    for (const friend of friends.value) {
      const existing = existingConfigs.find(
        c => c.friendHandle === friend.friendHandle,
      )
      locationConfigs[friend.friendHandle] = {
        enabled: existing?.enabled ?? false,
        expiresAt: existing?.expiresAt ?? null,
      }
    }
  } catch (error) {
    console.error('Failed to load location configs:', error)
  } finally {
    locationLoading.value = false
  }
}


const { syncKeys } = useSyncFriendKeys()

async function handleShare(friendHandle: string, duration: ShareDuration) {
  try {
    await locationShare.share(friendHandle, duration)
  } catch (error) {
    console.error('Failed to share location:', error)
  }
}

async function handleStopSharing(friendHandle: string) {
  try {
    await locationShare.stopSharing(friendHandle)
  } catch (error) {
    console.error('Failed to stop sharing:', error)
  }
}

function getLocationConfig(friendHandle: string) {
  return locationConfigs[friendHandle]
}

function getFriendLocation(friendHandle: string) {
  return friendLocations.getLocationForFriend(friendHandle)
}

const hasAnyLocationSharing = computed(() =>
  Object.values(locationConfigs).some(c => isShareActive(c, now.value)),
)

function handleLocationConfigChanged({
  friendHandle,
  ...state
}: { friendHandle: string } & LocationShareState) {
  locationConfigs[friendHandle] = state
}

onMounted(() => {
  appEventBus.on('location-config:changed', handleLocationConfigChanged)
  if (isSetupComplete.value) {
    friendLocations.fetchLocations()
  }
})

onUnmounted(() => {
  appEventBus.off('location-config:changed', handleLocationConfigChanged)
})
</script>

<template>
  <div class="flex flex-col gap-3 h-full">
    <!-- Setup required. Distinguish "you have an identity to restore"
         from "you don't have one yet" so the button copy matches the
         dialog the click will open — one of those gens a new seed,
         the other imports the existing one. -->
    <div
      v-if="!isSetupComplete"
      class="flex-1 flex flex-col items-center justify-center py-6 text-center gap-4"
    >
      <Users class="h-10 w-10 text-muted-foreground" />
      <p class="text-sm text-muted-foreground max-w-xs">
        {{
          needsImport
            ? t('friends.identity.restoreIdentityDescription')
            : t('friends.empty.setupRequired')
        }}
      </p>
      <Button @click="emit('setupIdentity')">
        {{ needsImport ? t('friends.identity.restoreIdentity') : t('friends.identity.setupButton') }}
      </Button>
    </div>

    <!-- Loading -->
    <div v-else-if="isLoading" class="flex-1 flex items-center justify-center">
      <Spinner class="h-6 w-6" />
    </div>

    <!-- Empty State -->
    <div
      v-else-if="isEmpty"
      class="flex-1 flex flex-col items-center justify-center py-6 text-center gap-4"
    >
      <Users class="h-10 w-10 text-muted-foreground" />
      <p class="text-sm text-muted-foreground">
        {{ t('friends.empty.title') }}
      </p>
      <Button @click="emit('addFriend')">
        <UserPlus class="h-4 w-4 mr-2" />
        {{ t('friends.addFirstFriend') }}
      </Button>
    </div>

    <!-- Friends List. No redundant inline "Friends" header — the parent
         tab already labels this section. The Add-Friend action sits as
         a compact right-aligned button with the count beside it. -->
    <template v-else>
      <div class="flex flex-col gap-2">
        <FriendCard
          v-for="friend in friends"
          :key="friend.id"
          :friend="friend"
          :friend-location="getFriendLocation(friend.friendHandle)"
          :location-config="getLocationConfig(friend.friendHandle)"
          :location-saving="locationSaving === friend.friendHandle"
          @remove="removeFriend"
          @share="handleShare"
          @stop-sharing="handleStopSharing"
          @sync-keys="syncKeys"
        />
      </div>

      <div class="flex-1"></div>

      <!-- E2EE notice (shows when any location sharing is enabled).
           Lets the `variant="success"` shade ladder handle the green
           tint — no more hardcoded green overrides. -->
      <TransitionFade>
        <Alert
          variant="success"
          v-if="hasAnyLocationSharing"
          class="flex items-center gap-3"
        >
          <Shield class="size-4 shrink-0" />
          <div>
            <p class="font-semibold text-sm">
              {{ t('friends.e2ee.title') }}
            </p>
            <p class="text-xs">
              {{ t('friends.e2ee.description') }}
            </p>
          </div>
        </Alert>
      </TransitionFade>
    </template>
  </div>
</template>
