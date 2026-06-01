<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useFriendsStore } from '@/stores/friends.store'
import { useIdentityStore } from '@/stores/identity.store'
import { useFriendLocations } from '@/composables/useFriendLocations'
import { useE2eeLocationBroadcast } from '@/composables/useE2eeLocationBroadcast'
import { useAppService } from '@/services/app.service'
import { useLocationService } from '@/services/location.service'
import { AppRoute } from '@/router'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Alert } from '@/components/ui/alert'
import {
  MapPinIcon,
  ShieldIcon,
  KeyIcon,
  MoreHorizontalIcon,
  RefreshCwIcon,
  TrashIcon,
  NavigationIcon,
  BatteryIcon,
  BatteryChargingIcon,
  ArrowRightIcon,
  WaypointsIcon,
} from 'lucide-vue-next'
import CopyButton from '@/components/CopyButton.vue'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import UserHandle from '@/components/UserHandle.vue'
import { useMapService } from '@/services/map.service'
import { useDirectionsService } from '@/services/directions.service'
import { appEventBus } from '@/lib/eventBus'
import { useUnits } from '@/composables/useUnits'

const props = defineProps<{
  handle: string
}>()

const router = useRouter()
const { t } = useI18n()
const friendsStore = useFriendsStore()
const identityStore = useIdentityStore()
const appService = useAppService()
const locationService = useLocationService()
const locationBroadcast = useE2eeLocationBroadcast()
const mapService = useMapService()
const directionsService = useDirectionsService()
const { formatSpeed, formatElevation } = useUnits()

const { friends } = storeToRefs(friendsStore)
const friendLocations = useFriendLocations()

// Local state for location config
interface LocationConfig {
  friendHandle: string
  enabled: boolean
}
const locationConfig = ref<LocationConfig | null>(null)

const isLoading = ref(true)
const isSyncing = ref(false)
const isSavingConfig = ref(false)

// Get the handle from props (Vue Router automatically decodes URL params)
const friendHandle = computed(() => props.handle)

// Find the friend by handle
const friend = computed(() => {
  return friends.value.find(f => f.friendHandle === friendHandle.value)
})

// Get friend's location
const friendLocation = computed(() => {
  return friendLocations.getLocationForFriend(friendHandle.value)
})

// Format time ago
function formatTimeAgo(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return t('friends.detail.justNow')
  if (minutes < 60) return t('friends.detail.minutesAgo', { count: minutes })
  if (hours < 24) return t('friends.detail.hoursAgo', { count: hours })
  return t('friends.detail.daysAgo', { count: days })
}

// Get initials from name or handle
function getInitials(name?: string | null, handle?: string): string {
  if (name) {
    return name
      .split(' ')
      .map(n => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase()
  }
  if (handle) {
    const alias = handle.split('@')[0]
    return alias.slice(0, 2).toUpperCase()
  }
  return '??'
}

// Get display name
const displayName = computed(() => {
  return (
    friend.value?.friendName ||
    friend.value?.friendHandle?.split('@')[0] ||
    'Unknown'
  )
})

const isLocationFresh = computed(() => {
  if (!friendLocation.value) return false
  return Date.now() - friendLocation.value.updatedAt.getTime() < 5 * 60_000
})

function getDirections() {
  if (!friendLocation.value) return

  const { lat, lng } = friendLocation.value.location
  const waypoint = {
    lngLat: { lng, lat },
    place: {
      id: `friend-${friend.value!.friendHandle}`,
      name: { value: displayName.value, sourceId: '' },
      geometry: { value: { type: 'point' as const, center: { lat, lng } }, sourceId: '' },
      externalIds: {},
      address: null,
      placeType: { value: 'friend', sourceId: '' },
    },
  }

  directionsService.directionsTo(waypoint)
  router.push({ name: AppRoute.DIRECTIONS })
}

// Load location config
async function loadLocationConfig() {
  try {
    const configs = await locationService.getE2eeConfigs()
    const config = configs.find(c => c.friendHandle === friendHandle.value)
    if (config) {
      locationConfig.value = {
        friendHandle: config.friendHandle,
        enabled: config.enabled,
      }
    } else {
      locationConfig.value = {
        friendHandle: friendHandle.value,
        enabled: false,
      }
    }
  } catch (error) {
    console.error('Failed to load location config:', error)
  }
}

// Toggle location sharing
async function toggleLocationSharing() {
  if (!friend.value || !locationConfig.value) return

  isSavingConfig.value = true
  try {
    const newEnabled = !locationConfig.value.enabled
    await locationService.setE2eeConfig(friend.value.friendHandle, {
      enabled: newEnabled,
    })
    locationConfig.value.enabled = newEnabled
    await locationBroadcast.refreshAndBroadcast()

    // Notify other components of the config change
    appEventBus.emit('location-config:changed', {
      friendHandle: friend.value.friendHandle,
      enabled: newEnabled,
    })
  } catch (error) {
    console.error('Failed to toggle sharing:', error)
    appService.toast.error(t('friends.detail.syncFailed'))
  } finally {
    isSavingConfig.value = false
  }
}

// Sync friend's keys
async function syncKeys() {
  isSyncing.value = true
  try {
    await friendsStore.syncKeys()
    await friendLocations.fetchLocations()
    appService.toast.success(t('friends.detail.keysSynced'))
  } catch (error) {
    appService.toast.error(t('friends.detail.syncFailed'))
  } finally {
    isSyncing.value = false
  }
}

// Center map on friend's location
function centerMapOnFriend() {
  if (!friendLocation.value) return
  mapService.flyTo({
    center: [
      friendLocation.value.location.lng,
      friendLocation.value.location.lat,
    ],
    zoom: 15,
  })
}

// Remove friend
async function handleRemoveFriend() {
  if (!friend.value) return

  const confirmed = await appService.confirm({
    title: t('friends.detail.removeFriend'),
    description: t('friends.detail.removeConfirmation', {
      name: displayName.value,
    }),
    continueText: t('general.delete'),
    cancelText: t('general.cancel'),
    destructive: true,
  })

  if (confirmed) {
    await friendsStore.remove(friend.value)
    router.push({ name: AppRoute.FRIENDS })
  }
}

onMounted(async () => {
  await identityStore.initialize()
  await friendsStore.loadAll()
  await loadLocationConfig()
  await friendLocations.fetchLocations()
  isLoading.value = false

  // Center map on friend's location when detail opens
  centerMapOnFriend()
})

// Redirect if friend not found after loading
watch([isLoading, friend], ([loading, f]) => {
  if (!loading && !f) {
    router.push({ name: AppRoute.FRIENDS })
  }
})
</script>

<template>
  <div v-if="isLoading" class="h-full flex items-center justify-center">
    <div class="animate-pulse text-muted-foreground">
      {{ t('general.loading') }}
    </div>
  </div>

  <div v-else-if="friend" class="h-full flex flex-col">
    <div class="flex-1 overflow-y-auto pt-2 pb-4">
      <div class="px-4">

    <!-- Hero profile -->
    <div class="flex flex-col items-center pt-2 pb-5">
      <Avatar class="size-20 ring-4 ring-background shadow-lg">
        <AvatarImage
          v-if="friend.friendPicture"
          :src="friend.friendPicture"
          :alt="displayName"
        />
        <AvatarFallback class="text-2xl font-medium">
          {{ getInitials(friend.friendName, friend.friendHandle) }}
        </AvatarFallback>
      </Avatar>

      <p class="text-xl font-semibold mt-3">{{ displayName }}</p>

      <div class="flex items-center gap-1 mt-0.5">
        <span class="text-sm text-muted-foreground">{{ friend.friendHandle }}</span>
        <CopyButton :text="friend.friendHandle" size="xs" variant="ghost" class="size-5 shrink-0" />
      </div>

      <!-- Status pill -->
      <div v-if="friendLocation" class="mt-2.5">
        <div
          class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium"
          :class="isLocationFresh
            ? 'bg-forest-500/10 text-forest-700 dark:text-forest-400'
            : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'"
        >
          <div
            class="size-1.5 rounded-full"
            :class="isLocationFresh ? 'bg-forest-500' : 'bg-amber-500'"
          />
          {{ isLocationFresh ? t('friends.detail.recentlySeen') : t('friends.detail.lastSeen') }}
          &middot;
          {{ formatTimeAgo(friendLocation.location.timestamp) }}
        </div>
      </div>

      <!-- Action buttons -->
      <div class="flex items-center gap-2 mt-4 w-full">
        <Button
          class="flex-1 gap-2"
          :disabled="!friendLocation"
          @click="getDirections"
        >
          <ArrowRightIcon class="size-4" />
          Directions
        </Button>
        <Button
          variant="outline"
          class="flex-1 gap-2"
          disabled
        >
          <WaypointsIcon class="size-4" />
          Start convoy
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" class="shrink-0">
              <MoreHorizontalIcon class="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-48">
            <DropdownMenuItem @click="syncKeys" :disabled="isSyncing">
              <RefreshCwIcon
                class="size-4"
                :class="{ 'animate-spin': isSyncing }"
              />
              {{ t('friends.detail.syncKeys') }}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              class="text-destructive"
              @click="handleRemoveFriend"
            >
              <TrashIcon class="size-4" />
              {{ t('friends.detail.removeFriend') }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>

    <!-- Location details -->
    <template v-if="friendLocation">
      <Separator />
      <div class="py-3 space-y-2">
        <div class="flex items-center gap-2 text-xs text-muted-foreground">
          <MapPinIcon class="size-3.5 shrink-0" />
          <span class="tabular-nums">
            {{ friendLocation.location.lat.toFixed(5) }}, {{ friendLocation.location.lng.toFixed(5) }}
          </span>
        </div>

        <div class="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          <div v-if="friendLocation.location.accuracy" class="flex items-center justify-between">
            <span class="text-muted-foreground">{{ t('friends.detail.accuracy') }}</span>
            <span class="tabular-nums">&plusmn;{{ Math.round(friendLocation.location.accuracy) }}m</span>
          </div>
          <div v-if="friendLocation.location.altitude != null && friendLocation.location.altitude !== 0" class="flex items-center justify-between">
            <span class="text-muted-foreground">{{ t('friends.detail.altitude') }}</span>
            <span class="tabular-nums">{{ formatElevation(friendLocation.location.altitude) }}</span>
          </div>
          <div v-if="friendLocation.location.speed != null" class="flex items-center justify-between">
            <span class="text-muted-foreground">{{ t('friends.detail.speed') }}</span>
            <span class="tabular-nums">
              <template v-if="friendLocation.location.speed > 0.5">{{ formatSpeed(friendLocation.location.speed) }}</template>
              <template v-else>{{ t('friends.detail.stationary') }}</template>
            </span>
          </div>
          <div v-if="friendLocation.location.heading != null" class="flex items-center justify-between">
            <span class="text-muted-foreground">{{ t('friends.detail.heading') }}</span>
            <span class="tabular-nums">{{ Math.round(friendLocation.location.heading) }}&deg;</span>
          </div>
          <div v-if="friendLocation.location.battery != null" class="flex items-center justify-between">
            <span class="text-muted-foreground">{{ t('friends.detail.battery') }}</span>
            <span class="tabular-nums flex items-center gap-1">
              {{ Math.round(friendLocation.location.battery * 100) }}%
              <component
                :is="friendLocation.location.batteryCharging ? BatteryChargingIcon : BatteryIcon"
                class="size-3"
                :class="friendLocation.location.batteryCharging ? 'text-forest-500' : 'text-muted-foreground'"
              />
            </span>
          </div>
        </div>
      </div>
    </template>

    <Separator />

    <!-- Location Sharing -->
    <div class="flex items-center justify-between gap-3 py-3">
      <div class="flex items-center gap-2.5">
        <MapPinIcon
          class="size-4"
          :class="locationConfig?.enabled ? 'text-primary' : 'text-muted-foreground'"
        />
        <div>
          <p class="text-sm font-medium">{{ t('friends.detail.shareMyLocation') }}</p>
          <p class="text-xs text-muted-foreground">
            {{ locationConfig?.enabled ? t('friends.detail.sharingEnabled') : t('friends.detail.sharingDisabled') }}
          </p>
        </div>
      </div>
      <Switch
        :model-value="locationConfig?.enabled ?? false"
        :disabled="isSavingConfig"
        @update:model-value="toggleLocationSharing"
      />
    </div>

    <Separator />

    <!-- E2EE Notice -->
    <Popover>
      <PopoverTrigger asChild>
        <button class="flex items-center gap-2.5 py-3 w-full text-left cursor-pointer group">
          <ShieldIcon class="size-4 text-muted-foreground shrink-0" />
          <div class="flex-1">
            <p class="text-sm font-medium">{{ t('friends.e2ee.title') }}</p>
            <p class="text-xs text-muted-foreground">{{ t('friends.e2ee.description') }}</p>
          </div>
          <KeyIcon class="size-3.5 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
        </button>
      </PopoverTrigger>
      <PopoverContent class="w-72" align="start">
        <div class="space-y-3">
          <div class="flex items-center gap-2">
            <KeyIcon class="size-3.5 text-muted-foreground" />
            <p class="font-medium text-sm">{{ t('friends.detail.security') }}</p>
          </div>
          <div class="space-y-1">
            <p class="text-[10px] text-muted-foreground">{{ t('friends.detail.encryptionKey') }}</p>
            <div class="flex items-start gap-1.5">
              <code class="flex-1 text-[10px] font-mono text-muted-foreground/80 bg-muted p-1.5 rounded break-all leading-relaxed max-h-16 overflow-y-auto">{{ friend.friendEncryptionKey ?? 'N/A' }}</code>
              <CopyButton v-if="friend.friendEncryptionKey" :text="friend.friendEncryptionKey" class="shrink-0" />
            </div>
          </div>
          <div class="space-y-1">
            <p class="text-[10px] text-muted-foreground">{{ t('friends.detail.signingKey') }}</p>
            <div class="flex items-start gap-1.5">
              <code class="flex-1 text-[10px] font-mono text-muted-foreground/80 bg-muted p-1.5 rounded break-all leading-relaxed max-h-16 overflow-y-auto">{{ friend.friendSigningKey ?? 'N/A' }}</code>
              <CopyButton v-if="friend.friendSigningKey" :text="friend.friendSigningKey" class="shrink-0" />
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
      </div>
    </div>
  </div>
</template>
