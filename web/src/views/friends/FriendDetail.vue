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
  MountainIcon,
  GaugeIcon,
  CircleDotIcon,
  BatteryIcon,
  BatteryChargingIcon,
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
import { appEventBus } from '@/lib/eventBus'
import DetailPanelLayout from '@/components/layouts/DetailPanelLayout.vue'
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
  <!-- Loading State -->
  <div v-if="isLoading" class="h-full flex items-center justify-center">
    <div class="animate-pulse text-muted-foreground">
      {{ t('general.loading') }}
    </div>
  </div>

  <!-- Content -->
  <DetailPanelLayout v-else-if="friend" :title="displayName">
    <template #actions>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" class="-mr-2">
            <MoreHorizontalIcon class="size-5" />
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
    </template>

    <div class="space-y-5">
      <!-- Avatar & Identity -->
      <div class="flex flex-col items-center text-center space-y-3">
        <div class="relative">
          <Avatar class="size-24 ring-4 ring-background shadow-xl">
            <AvatarImage
              v-if="friend.friendPicture"
              :src="friend.friendPicture"
              :alt="displayName"
            />
            <AvatarFallback
              class="text-2xl font-medium bg-gradient-to-br from-primary/20 to-primary/5 text-primary"
            >
              {{ getInitials(friend.friendName, friend.friendHandle) }}
            </AvatarFallback>
          </Avatar>

          <!-- Location Status Indicator with Timestamp -->
          <div
            v-if="friendLocation"
            class="absolute -bottom-1 right-1/2 translate-x-1/2 px-2 py-0.5 rounded-full bg-emerald-500 border-2 border-background flex items-center justify-center"
          >
            <span class="text-[10px] font-medium text-white whitespace-nowrap">
              {{ formatTimeAgo(friendLocation.location.timestamp) }}
            </span>
          </div>
        </div>

        <div class="space-y-1.5 pt-2">
          <h2 class="text-xl font-bold tracking-tight">
            {{ displayName }}
          </h2>
          <!-- User Handle with Copy -->
          <UserHandle :handle="friend.friendHandle" class="w-full max-w-xs" />
        </div>
      </div>

      <!-- Location Info -->
      <div v-if="friendLocation" class="space-y-2">
        <!-- Location Details Grid -->
        <div class="grid grid-cols-2 gap-2 text-xs">
          <!-- Coordinates -->
          <div
            class="col-span-2 flex items-center gap-2 p-2.5 rounded-md bg-muted/40"
          >
            <MapPinIcon class="size-4 text-emerald-600 shrink-0" />
            <p class="text-sm font-medium tabular-nums">
              {{ friendLocation.location.lat.toFixed(6) }},
              {{ friendLocation.location.lng.toFixed(6) }}
            </p>
          </div>
          <!-- Accuracy -->
          <div
            v-if="friendLocation.location.accuracy"
            class="flex items-center gap-2 p-2 rounded-md bg-muted/30"
          >
            <CircleDotIcon class="size-4 text-muted-foreground" />
            <div>
              <p class="text-muted-foreground">
                {{ t('friends.detail.accuracy') }}
              </p>
              <p class="font-medium">
                ±{{ Math.round(friendLocation.location.accuracy) }}m
              </p>
            </div>
          </div>

          <!-- Altitude (only show if > 0, as 0 usually means unavailable) -->
          <div
            v-if="
              friendLocation.location.altitude != null &&
              friendLocation.location.altitude !== 0
            "
            class="flex items-center gap-2 p-2 rounded-md bg-muted/30"
          >
            <MountainIcon class="size-4 text-muted-foreground" />
            <div>
              <p class="text-muted-foreground">
                {{ t('friends.detail.altitude') }}
              </p>
              <p class="font-medium">
                {{ formatElevation(friendLocation.location.altitude) }}
              </p>
            </div>
          </div>

          <!-- Speed -->
          <div
            v-if="friendLocation.location.speed != null"
            class="flex items-center gap-2 p-2 rounded-md bg-muted/30"
          >
            <GaugeIcon class="size-4 text-muted-foreground" />
            <div>
              <p class="text-muted-foreground">
                {{ t('friends.detail.speed') }}
              </p>
              <p class="font-medium">
                <template v-if="friendLocation.location.speed > 0.5">
                  {{ formatSpeed(friendLocation.location.speed) }}
                </template>
                <template v-else>
                  {{ t('friends.detail.stationary') }}
                </template>
              </p>
            </div>
          </div>

          <!-- Heading -->
          <div
            v-if="friendLocation.location.heading != null"
            class="flex items-center gap-2 p-2 rounded-md bg-muted/30"
          >
            <NavigationIcon
              class="size-4 text-muted-foreground"
              :style="{
                transform: `rotate(${friendLocation.location.heading}deg)`,
              }"
            />
            <div>
              <p class="text-muted-foreground">
                {{ t('friends.detail.heading') }}
              </p>
              <p class="font-medium">
                {{ Math.round(friendLocation.location.heading) }}°
              </p>
            </div>
          </div>

          <!-- Battery -->
          <div
            v-if="friendLocation.location.battery != null"
            class="flex items-center gap-2 p-2 rounded-md bg-muted/30"
          >
            <component
              :is="
                friendLocation.location.batteryCharging
                  ? BatteryChargingIcon
                  : BatteryIcon
              "
              class="size-4"
              :class="
                friendLocation.location.batteryCharging
                  ? 'text-green-500'
                  : 'text-muted-foreground'
              "
            />
            <div>
              <p class="text-muted-foreground">
                {{ t('friends.detail.battery') }}
              </p>
              <p class="font-medium flex items-center gap-1">
                {{ Math.round(friendLocation.location.battery * 100) }}%
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- No Location State -->
      <div
        v-else
        class="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-dashed border-muted-foreground/20"
      >
        <div
          class="size-9 rounded-full bg-muted flex items-center justify-center shrink-0"
        >
          <MapPinIcon class="size-4 text-muted-foreground" />
        </div>
        <div class="flex-1">
          <p class="text-sm font-medium text-muted-foreground">
            {{ t('friends.detail.noLocationData') }}
          </p>
          <p class="text-xs text-muted-foreground/70">
            {{ t('friends.detail.noLocationDescription') }}
          </p>
        </div>
      </div>

      <Separator />

      <!-- Location Sharing Toggle -->
      <div class="flex items-center justify-between gap-3 py-1">
        <div class="flex items-center gap-2.5">
          <MapPinIcon
            class="size-4"
            :class="
              locationConfig?.enabled ? 'text-primary' : 'text-muted-foreground'
            "
          />
          <div>
            <Label class="text-sm font-medium">
              {{ t('friends.detail.shareMyLocation') }}
            </Label>
            <p class="text-xs text-muted-foreground">
              {{
                locationConfig?.enabled
                  ? t('friends.detail.sharingEnabled')
                  : t('friends.detail.sharingDisabled')
              }}
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

      <!-- E2EE Notice with Security Keys Popover -->
      <Popover>
        <PopoverTrigger asChild>
          <Alert
            variant="success"
            class="flex items-center gap-3 px-4 py-3 rounded-lg bg-green-500/10 border-green-500/50 cursor-pointer hover:bg-green-500/15 transition-colors"
          >
            <ShieldIcon class="size-4 shrink-0 text-green-600" />
            <div class="flex-1">
              <p
                class="font-semibold text-sm text-green-700 dark:text-green-400"
              >
                {{ t('friends.e2ee.title') }}
              </p>
              <p class="text-xs text-muted-foreground">
                {{ t('friends.e2ee.description') }}
              </p>
            </div>
            <KeyIcon class="size-4 text-green-600/50" />
          </Alert>
        </PopoverTrigger>
        <PopoverContent class="w-80" align="center">
          <div class="space-y-3">
            <div class="flex items-center gap-2">
              <KeyIcon class="size-4 text-muted-foreground" />
              <h4 class="font-medium text-sm">
                {{ t('friends.detail.security') }}
              </h4>
            </div>
            <!-- Encryption Key -->
            <div class="space-y-1">
              <p
                class="text-[10px] text-muted-foreground uppercase tracking-wider"
              >
                {{ t('friends.detail.encryptionKey') }}
              </p>
              <div class="flex items-start gap-2">
                <code
                  class="flex-1 text-[10px] font-mono text-muted-foreground/90 bg-muted p-2 rounded break-all leading-relaxed max-h-20 overflow-y-auto"
                  >{{ friend.friendEncryptionKey ?? 'N/A' }}</code
                >
                <CopyButton
                  v-if="friend.friendEncryptionKey"
                  :text="friend.friendEncryptionKey"
                  class="shrink-0"
                />
              </div>
            </div>
            <!-- Signing Key -->
            <div class="space-y-1">
              <p
                class="text-[10px] text-muted-foreground uppercase tracking-wider"
              >
                {{ t('friends.detail.signingKey') }}
              </p>
              <div class="flex items-start gap-2">
                <code
                  class="flex-1 text-[10px] font-mono text-muted-foreground/90 bg-muted p-2 rounded break-all leading-relaxed max-h-20 overflow-y-auto"
                  >{{ friend.friendSigningKey ?? 'N/A' }}</code
                >
                <CopyButton
                  v-if="friend.friendSigningKey"
                  :text="friend.friendSigningKey"
                  class="shrink-0"
                />
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  </DetailPanelLayout>
</template>
