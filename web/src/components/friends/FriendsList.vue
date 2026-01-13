<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useFriendsStore } from '@/stores/friends.store'
import { useIdentityStore } from '@/stores/identity.store'
import { useLocationService } from '@/services/location.service'
import { useE2eeLocationBroadcast } from '@/composables/useE2eeLocationBroadcast'
import { useFriendLocations } from '@/composables/useFriendLocations'
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
const { isSetupComplete } = storeToRefs(identityStore)

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
</script>

<template>
  <div class="flex flex-col gap-2 h-full">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <Users class="h-5 w-5" />
        <h3 class="font-semibold">{{ t('friends.title') }}</h3>
        <span v-if="friends.length" class="text-sm text-muted-foreground">
          ({{ friends.length }})
        </span>
      </div>
      <Button
        v-if="isSetupComplete"
        variant="outline"
        size="sm"
        @click="emit('addFriend')"
      >
        <UserPlus class="h-4 w-4 mr-2" />
        {{ t('friends.addFriend') }}
      </Button>
    </div>

    <!-- Setup Required -->
    <div
      v-if="!isSetupComplete"
      class="flex flex-col items-center justify-center py-8 text-center"
    >
      <Users class="h-12 w-12 text-muted-foreground mb-4" />
      <p class="text-muted-foreground mb-4">
        {{ t('friends.empty.setupRequired') }}
      </p>
      <Button @click="emit('setupIdentity')">{{
        t('friends.identity.setupButton')
      }}</Button>
    </div>

    <!-- Loading -->
    <div v-else-if="isLoading" class="flex justify-center py-8">
      <Spinner class="h-6 w-6" />
    </div>

    <!-- Empty State -->
    <div
      v-else-if="isEmpty"
      class="flex flex-col items-center justify-center py-8 text-center"
    >
      <Users class="h-12 w-12 text-muted-foreground mb-4" />
      <p class="text-muted-foreground mb-4">
        {{ t('friends.empty.title') }}
      </p>
      <Button variant="outline" @click="emit('addFriend')">
        <UserPlus class="h-4 w-4 mr-2" />
        {{ t('friends.addFirstFriend') }}
      </Button>
    </div>

    <!-- Friends List -->
    <template v-else>
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
