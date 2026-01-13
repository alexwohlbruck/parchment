<script setup lang="ts">
import { computed } from 'vue'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip'

// Simple translation function - markers are rendered outside app context
function t(key: string, params?: Record<string, any>): string {
  const translations: Record<string, string> = {
    'friends.map.justNow': 'just now',
    'friends.map.minutesAgo': `${params?.n || 0}m ago`,
    'friends.map.hoursAgo': `${params?.n || 0}h ago`,
    'friends.map.daysAgo': `${params?.n || 0}d ago`,
    'friends.map.lastSeen': 'Last seen',
    'friends.map.updated': 'Updated',
    'friends.map.accuracy': `±${params?.meters || 0}m`,
  }
  return translations[key] || key
}

interface Props {
  friendHandle: string
  friendAlias: string
  friendName?: string
  friendAvatar?: string
  updatedAt: Date
  accuracy?: number
}

const props = defineProps<Props>()

const displayName = computed(() => {
  return props.friendName || props.friendAlias
})

const initials = computed(() => {
  const name = props.friendName || props.friendAlias
  // Get first letter of first two words, or first two letters
  const words = name.split(/\s+/)
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
})

/**
 * Simple time ago formatter
 */
function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)

  if (seconds < 60) return t('friends.map.justNow')
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return t('friends.map.minutesAgo', { n: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('friends.map.hoursAgo', { n: hours })
  const days = Math.floor(hours / 24)
  if (days < 7) return t('friends.map.daysAgo', { n: days })
  return date.toLocaleDateString()
}

const timeAgo = computed(() => {
  return formatTimeAgo(props.updatedAt)
})

const isStale = computed(() => {
  // Consider stale if older than 5 minutes
  const fiveMinutes = 5 * 60 * 1000
  return Date.now() - props.updatedAt.getTime() > fiveMinutes
})
</script>

<template>
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <div class="friend-location-marker" :class="{ stale: isStale }">
          <!-- Pulsing ring behind the avatar -->
          <div class="marker-pulse" />

          <!-- Main avatar -->
          <div class="marker-avatar">
            <Avatar class="avatar-circle">
              <AvatarImage
                v-if="friendAvatar"
                :src="friendAvatar"
                :alt="displayName"
              />
              <AvatarFallback class="avatar-fallback">
                {{ initials }}
              </AvatarFallback>
            </Avatar>

            <!-- Online indicator dot -->
            <div v-if="!isStale" class="online-indicator" />
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" :sideOffset="12">
        <div class="flex flex-col gap-0.5">
          <p class="font-semibold text-sm">{{ displayName }}</p>
          <p class="text-xs text-muted-foreground">
            {{ isStale ? t('friends.map.lastSeen') : t('friends.map.updated') }} {{ timeAgo }}
          </p>
          <p
            v-if="accuracy && accuracy > 30"
            class="text-xs text-muted-foreground"
          >
            {{ t('friends.map.accuracy', { meters: Math.round(accuracy) }) }}
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>

<style scoped>
.friend-location-marker {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  /* Centering is handled by Mapbox/Maplibre marker anchor: 'center' */
}

.marker-avatar {
  position: relative;
  z-index: 2;
  transition: transform 0.15s ease;
}

.friend-location-marker:hover .marker-avatar {
  transform: scale(1.15);
}

.avatar-circle {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 3px solid white;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(0, 0, 0, 0.08);
}

.avatar-fallback {
  background: linear-gradient(
    135deg,
    hsl(var(--primary)) 0%,
    hsl(var(--primary) / 0.8) 100%
  );
  color: hsl(var(--primary-foreground));
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.online-indicator {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #22c55e;
  border: 2px solid white;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

.marker-pulse {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: hsl(var(--primary) / 0.25);
  animation: pulse 2.5s ease-out infinite;
  z-index: 1;
}

.friend-location-marker.stale .marker-pulse {
  animation: none;
  opacity: 0;
}

.friend-location-marker.stale .avatar-fallback {
  background: hsl(var(--muted-foreground));
}

.friend-location-marker.stale .avatar-circle {
  border-color: hsl(var(--muted));
  opacity: 0.8;
}

@keyframes pulse {
  0% {
    transform: translate(-50%, -50%) scale(0.9);
    opacity: 0.6;
  }
  70% {
    transform: translate(-50%, -50%) scale(1.8);
    opacity: 0;
  }
  100% {
    transform: translate(-50%, -50%) scale(1.8);
    opacity: 0;
  }
}
</style>
