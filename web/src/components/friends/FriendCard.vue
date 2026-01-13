<script setup lang="ts">
import { computed } from 'vue'
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
import { MoreVertical, UserMinus, ExternalLink, MapPin } from 'lucide-vue-next'
import type { Friendship } from '@/services/friends.service'
import type { FriendLocation } from '@/composables/useFriendLocations'

const { t } = useI18n()

interface LocationConfig {
  enabled: boolean
}

interface Props {
  friend: Friendship
  friendLocation?: FriendLocation
  locationConfig?: LocationConfig
  locationSaving?: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  remove: [friend: Friendship]
  toggleLocation: [friendHandle: string, enabled: boolean]
}>()

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
    (Date.now() - props.friendLocation.updatedAt.getTime()) / 1000,
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

const isLocationFresh = computed(() => {
  if (!props.friendLocation) return false
  // Consider fresh if updated within last 5 minutes
  const fiveMinutes = 5 * 60 * 1000
  return Date.now() - props.friendLocation.updatedAt.getTime() < fiveMinutes
})
</script>

<template>
  <Card class="overflow-hidden">
    <!-- Main Content -->
    <div class="p-4 flex items-center gap-3">
      <Avatar class="h-11 w-11 shrink-0">
        <AvatarImage
          v-if="friend.friendPicture"
          :src="friend.friendPicture"
          :alt="displayName"
        />
        <AvatarFallback>{{ initials }}</AvatarFallback>
      </Avatar>

      <div class="min-w-0 flex-1">
        <p class="font-medium truncate">{{ displayName }}</p>
        <p class="text-sm text-muted-foreground truncate">
          {{ alias }}<span v-if="isRemote">@{{ domain }}</span>
        </p>
        <!-- Friend's location info -->
        <div v-if="hasLocation" class="flex items-center gap-1.5 mt-1">
          <div
            class="w-2 h-2 rounded-full shrink-0"
            :class="isLocationFresh ? 'bg-green-500' : 'bg-muted-foreground/50'"
          />
          <span class="text-xs text-muted-foreground truncate">
            {{ locationTimeAgo }}
          </span>
        </div>
      </div>

      <!-- Menu -->
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" class="h-8 w-8 shrink-0">
            <MoreVertical class="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            @click="emit('remove', friend)"
            class="text-destructive"
          >
            <UserMinus class="h-4 w-4 mr-2" />
            {{ t('friends.removeFriend') }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <!-- Location Sharing Bar -->
    <div
      class="px-4 py-2.5 flex items-center justify-between gap-3 border-t border-border/50 bg-muted/30"
    >
      <div class="flex items-center gap-2 text-sm">
        <MapPin
          class="h-4 w-4 shrink-0"
          :class="
            locationConfig?.enabled ? 'text-primary' : 'text-muted-foreground'
          "
        />
        <span class="text-muted-foreground">{{
          t('friends.locationSharing')
        }}</span>
      </div>

      <div class="flex items-center gap-2">
        <!-- Toggle -->
        <Switch
          :model-value="locationConfig?.enabled ?? false"
          @update:model-value="(v: boolean) => emit('toggleLocation', friend.friendHandle, v)"
          :disabled="locationSaving"
          class="scale-90"
        />
        <Spinner v-if="locationSaving" class="h-4 w-4" />
      </div>
    </div>
  </Card>
</template>
