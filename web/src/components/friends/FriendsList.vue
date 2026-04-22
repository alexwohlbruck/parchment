<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useFriendsStore } from '@/stores/friends.store'
import { useIdentityStore } from '@/stores/identity.store'
import { useLocationService } from '@/services/location.service'
import { useE2eeLocationBroadcast } from '@/composables/useE2eeLocationBroadcast'
import { useFriendLocations } from '@/composables/useFriendLocations'
import { appEventBus } from '@/lib/eventBus'
import FriendCard from './FriendCard.vue'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { UserPlus, Users, Shield } from 'lucide-vue-next'
import type { Friendship } from '@/services/friends.service'
import Alert from '@/components/ui/alert/Alert.vue'
import { TransitionFade } from '@morev/vue-transitions'

const { t } = useI18n()

const friendsStore = useFriendsStore()
const identityStore = useIdentityStore()
const locationService = useLocationService()
const locationBroadcast = useE2eeLocationBroadcast()
const friendLocations = useFriendLocations()

const { friends, isLoading } = storeToRefs(friendsStore)
const { isSetupComplete, needsImport } = storeToRefs(identityStore)

const emit = defineEmits<{
  addFriend: []
  setupIdentity: []
}>()

interface LocationConfig {
  friendHandle: string
  enabled: boolean
  refreshInterval: number
}

const locationConfigs = reactive<Record<string, LocationConfig>>({})
const locationLoading = ref(true)
const locationSaving = ref<string | null>(null)

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
        friendHandle: friend.friendHandle,
        enabled: existing?.enabled ?? false,
        refreshInterval: existing?.refreshInterval ?? 60,
      }
    }
  } catch (error) {
    console.error('Failed to load location configs:', error)
  } finally {
    locationLoading.value = false
  }
}

async function handleRemove(friend: Friendship) {
  await friendsStore.remove(friend)
}

async function handleSyncKeys() {
  await friendsStore.syncKeys()
  await friendLocations.fetchLocations()
}

async function handleToggleLocation(friendHandle: string, enabled: boolean) {
  locationSaving.value = friendHandle
  try {
    // Initialize config if it doesn't exist
    const config = locationConfigs[friendHandle] ?? {
      friendHandle,
      enabled: false,
      refreshInterval: 60,
    }

    if (enabled) {
      await locationService.setE2eeConfig(friendHandle, {
        enabled: true,
        refreshInterval: config.refreshInterval,
      })
    } else {
      await locationService.disableE2eeSharing(friendHandle)
    }

    locationConfigs[friendHandle] = { ...config, enabled }

    // Notify the broadcast service to refresh its config and broadcast if needed
    await locationBroadcast.refreshAndBroadcast()
  } catch (error) {
    console.error('Failed to toggle sharing:', error)
  } finally {
    locationSaving.value = null
  }
}

function getLocationConfig(friendHandle: string) {
  return locationConfigs[friendHandle]
}

function getFriendLocation(friendHandle: string) {
  return friendLocations.getLocationForFriend(friendHandle)
}

const hasAnyLocationSharing = computed(() => {
  return Object.values(locationConfigs).some(c => c.enabled)
})

// Listen for location config changes from other components (e.g., FriendDetail)
function handleLocationConfigChanged({ friendHandle, enabled }: { friendHandle: string; enabled: boolean }) {
  if (locationConfigs[friendHandle]) {
    locationConfigs[friendHandle].enabled = enabled
  }
}

onMounted(() => {
  appEventBus.on('location-config:changed', handleLocationConfigChanged)
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
            ? 'Your account has a federation identity — restore it here to connect with friends.'
            : t('friends.empty.setupRequired')
        }}
      </p>
      <Button @click="emit('setupIdentity')">
        {{ needsImport ? 'Restore identity' : t('friends.identity.setupButton') }}
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
      <div class="flex items-center justify-between">
        <span class="text-xs text-muted-foreground">
          {{ friends.length }}
          {{ friends.length === 1 ? 'friend' : 'friends' }}
        </span>
        <Button
          variant="outline"
          size="sm"
          @click="emit('addFriend')"
        >
          <UserPlus class="h-4 w-4 mr-2" />
          {{ t('friends.addFriend') }}
        </Button>
      </div>

      <div class="flex flex-col gap-2">
        <FriendCard
          v-for="friend in friends"
          :key="friend.id"
          :friend="friend"
          :friend-location="getFriendLocation(friend.friendHandle)"
          :location-config="getLocationConfig(friend.friendHandle)"
          :location-saving="locationSaving === friend.friendHandle"
          @remove="handleRemove"
          @toggle-location="handleToggleLocation"
          @sync-keys="handleSyncKeys"
        />
      </div>

      <div class="flex-1"></div>

      <!-- E2EE notice (shows when any location sharing is enabled) -->
      <TransitionFade>
        <Alert
          variant="success"
          v-if="hasAnyLocationSharing"
          class="flex items-center gap-3 px-4 py-3 rounded-lg bg-green-500/10 border-green-500/50"
        >
          <Shield class="size-4 shrink-0" />
          <div>
            <p class="font-semibold text-sm text-green-700 dark:text-green-400">
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
