<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Switch } from '@/components/ui/switch'
import { Spinner } from '@/components/ui/spinner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MoreVertical, UserMinus, MapPin, RefreshCwIcon } from 'lucide-vue-next'
import { AppRoute } from '@/router'
import type { Friendship } from '@/services/friends.service'
import type { FriendLocation } from '@/composables/friends/useFriendLocations'
import { useLocationClock } from '@/composables/friends/useLocationClock'
import { isLocationStale } from '@/lib/friends/friend-location'
import { handleDomain, isRemoteHandle } from '@/lib/identity/handle'
import { useIdentityStore } from '@/stores/identity.store'
import { isShareActive } from '@server/lib/location-share'
import {
  formatShareTimeLeft,
  type LocationShareState,
  type ShareDuration,
} from '@/lib/friends/share-duration'
import ShareDurationMenu from './ShareDurationMenu.vue'

const router = useRouter()
const { t } = useI18n()
const now = useLocationClock()

interface Props {
  friend: Friendship
  friendLocation?: FriendLocation
  locationConfig?: LocationShareState
  locationSaving?: boolean
}

const props = defineProps<Props>()

const isSharing = computed(
  () => !!props.locationConfig && isShareActive(props.locationConfig, now.value),
)
const timeLeft = computed(() =>
  isSharing.value
    ? formatShareTimeLeft(props.locationConfig?.expiresAt ?? null, t, now.value)
    : null,
)

const identityStore = useIdentityStore()
const sharingUnavailable = computed(
  () =>
    !isSharing.value &&
    isRemoteHandle(props.friend.friendHandle, handleDomain(identityStore.handle ?? '')),
)

const emit = defineEmits<{
  remove: [friend: Friendship]
  share: [friendHandle: string, duration: ShareDuration]
  stopSharing: [friendHandle: string]
  syncKeys: []
}>()

const share = (duration: ShareDuration) =>
  emit('share', props.friend.friendHandle, duration)

const alias = computed(() => {
  return props.friend.friendHandle.split('@')[0]
})

const domain = computed(() => {
  return props.friend.friendHandle.split('@')[1]
})

const displayName = computed(() => {
  return props.friend.friendName || alias.value
})

const initials = computed(() => {
  const name = props.friend.friendName || alias.value
  // Get first letter of first two words, or first two letters
  const words = name.split(/\s+/)
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
})

const isRemote = computed(() => {
  return !!domain.value
})

// Location info
const hasLocation = computed(() => !!props.friendLocation)

const locationTimeAgo = computed(() => {
  if (!props.friendLocation) return null
  const seconds = Math.floor(
    (now.value.getTime() - props.friendLocation.updatedAt.getTime()) / 1000,
  )

  if (seconds < 60) return t('friends.map.justNow')
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return t('friends.map.minutesAgo', { n: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('friends.map.hoursAgo', { n: hours })
  const days = Math.floor(hours / 24)
  if (days < 7) return t('friends.map.daysAgo', { n: days })
  return props.friendLocation.updatedAt.toLocaleDateString()
})

const isLocationFresh = computed(
  () =>
    !!props.friendLocation &&
    !isLocationStale(props.friendLocation.updatedAt, now.value.getTime()),
)

function openFriendDetail() {
  router.push({
    name: AppRoute.FRIEND_DETAIL,
    params: { handle: props.friend.friendHandle },
  })
}
</script>

<template>
  <Card class="overflow-hidden group">
    <!-- Main Content (Clickable) -->
    <div
      class="px-3 py-2.5 flex items-center gap-3 cursor-pointer hover:bg-muted/50 transition-colors"
      @click="openFriendDetail"
    >
      <Avatar class="size-10 shrink-0">
        <AvatarImage
          v-if="friend.friendPicture"
          :src="friend.friendPicture"
          :alt="displayName"
        />
        <AvatarFallback class="text-sm">{{ initials }}</AvatarFallback>
      </Avatar>

      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold truncate leading-tight">{{ displayName }}</p>
        <p class="text-xs text-muted-foreground truncate leading-tight">
          {{ alias }}<span v-if="isRemote">@{{ domain }}</span>
        </p>
        <div v-if="hasLocation" class="flex items-center gap-1.5 mt-0.5">
          <div
            class="size-1.5 rounded-full shrink-0"
            :class="isLocationFresh ? 'bg-forest-500' : 'bg-muted-foreground/50'"
          />
          <span class="text-[11px] text-muted-foreground truncate">
            {{ locationTimeAgo }}
          </span>
        </div>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            class="size-7 shrink-0"
            @click.stop
          >
            <MoreVertical class="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem @click="emit('syncKeys')">
            <RefreshCwIcon class="size-4" />
            {{ t('friends.detail.syncKeys') }}
          </DropdownMenuItem>
          <DropdownMenuItem
            @click="emit('remove', friend)"
            class="text-destructive"
          >
            <UserMinus class="size-4" />
            {{ t('friends.removeFriend') }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <div
      class="px-3 py-2 flex items-center justify-between gap-3 border-t border-border/50 bg-muted/30"
    >
      <div class="flex items-center gap-2 text-xs">
        <MapPin
          class="size-3.5 shrink-0"
          :class="isSharing ? 'text-primary' : 'text-muted-foreground'"
        />
        <span class="text-muted-foreground">{{
          t('friends.locationSharing')
        }}</span>
      </div>

      <span
        v-if="sharingUnavailable"
        class="text-xs text-muted-foreground text-right"
      >
        {{ t('friends.remoteLocationUnavailable') }}
      </span>
      <div v-else class="flex items-center gap-2">
        <Spinner v-if="locationSaving" class="size-3.5" />
        <ShareDurationMenu v-if="timeLeft" :disabled="locationSaving" @select="share">
          <button
            type="button"
            class="text-xs text-muted-foreground tabular-nums hover:text-foreground transition-colors"
            :aria-label="t('friends.sharing.change')"
          >
            {{ timeLeft }}
          </button>
        </ShareDurationMenu>
        <Switch
          v-if="isSharing"
          :model-value="true"
          :disabled="locationSaving"
          @update:model-value="emit('stopSharing', friend.friendHandle)"
        />
        <ShareDurationMenu v-else :disabled="locationSaving" @select="share">
          <Switch :model-value="false" :disabled="locationSaving" />
        </ShareDurationMenu>
      </div>
    </div>
  </Card>
</template>
