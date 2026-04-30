<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useFriendsStore } from '@/stores/friends.store'
import { useLocationService } from '@/services/location.service'
import { useE2eeLocationBroadcast } from '@/composables/useE2eeLocationBroadcast'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Spinner } from '@/components/ui/spinner'
import { MapPin, Shield, Users } from 'lucide-vue-next'

const { t } = useI18n()

const friendsStore = useFriendsStore()
const locationService = useLocationService()
const locationBroadcast = useE2eeLocationBroadcast()

const { friends } = storeToRefs(friendsStore)

interface SharingConfig {
  friendHandle: string
  enabled: boolean
}

const configs = ref<Map<string, SharingConfig>>(new Map())
const loading = ref(true)
const saving = ref<string | null>(null)

onMounted(async () => {
  try {
    // Load friends if not already loaded
    await friendsStore.loadFriends()

    // Load existing configs
    const existingConfigs = await locationService.getE2eeConfigs()

    // Initialize configs for all friends
    for (const friend of friends.value) {
      const existing = existingConfigs.find(
        c => c.friendHandle === friend.friendHandle,
      )
      configs.value.set(friend.friendHandle, {
        friendHandle: friend.friendHandle,
        enabled: existing?.enabled ?? false,
      })
    }
  } catch (error) {
    console.error('Failed to load location sharing configs:', error)
  } finally {
    loading.value = false
  }
})

async function toggleSharing(friendHandle: string, enabled: boolean) {
  saving.value = friendHandle
  try {
    const config = configs.value.get(friendHandle)
    if (!config) return

    if (enabled) {
      await locationService.setE2eeConfig(friendHandle, { enabled: true })
    } else {
      await locationService.disableE2eeSharing(friendHandle)
    }

    config.enabled = enabled

    // Notify the broadcast service to refresh its config and broadcast if needed
    await locationBroadcast.refreshAndBroadcast()
  } catch (error) {
    console.error('Failed to toggle sharing:', error)
  } finally {
    saving.value = null
  }
}

function getFriendInitials(handle: string): string {
  const alias = handle.split('@')[0]
  return alias.substring(0, 2).toUpperCase()
}

function getFriendDisplayName(handle: string): string {
  return handle.split('@')[0]
}
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle class="flex items-center gap-2">
        <MapPin class="h-5 w-5" />
        {{ t('friends.locationSettings.title') }}
      </CardTitle>
      <CardDescription>
        {{ t('friends.locationSettings.description') }}
      </CardDescription>
    </CardHeader>
    <CardContent>
      <div v-if="loading" class="flex justify-center py-8">
        <Spinner />
      </div>

      <div v-else-if="friends.length === 0" class="text-center py-8">
        <Users class="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <p class="text-muted-foreground">
          {{ t('friends.locationSettings.addFriendsPrompt') }}
        </p>
      </div>

      <div v-else class="space-y-4">
        <div
          v-for="friend in friends"
          :key="friend.friendHandle"
          class="flex items-center justify-between p-4 rounded-lg border bg-card"
        >
          <div class="flex items-center gap-3">
            <Avatar class="h-10 w-10">
              <AvatarFallback>{{
                getFriendInitials(friend.friendHandle)
              }}</AvatarFallback>
            </Avatar>
            <div>
              <p class="font-medium">
                {{ getFriendDisplayName(friend.friendHandle) }}
              </p>
              <p class="text-sm text-muted-foreground">
                {{ friend.friendHandle }}
              </p>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <!-- Toggle switch -->
            <Switch
              :model-value="configs.get(friend.friendHandle)?.enabled ?? false"
              @update:model-value="(v: boolean) => toggleSharing(friend.friendHandle, v)"
              :disabled="saving === friend.friendHandle"
            />
            <Spinner v-if="saving === friend.friendHandle" class="h-4 w-4" />
          </div>
        </div>

        <!-- E2EE notice -->
        <div class="flex items-start gap-3 p-4 rounded-lg bg-muted/50">
          <Shield class="h-5 w-5 text-green-500 shrink-0 mt-0.5" />
          <div class="text-sm">
            <p class="font-medium text-green-700 dark:text-green-400">
              {{ t('friends.e2ee.title') }}
            </p>
            <p class="text-muted-foreground">
              {{ t('friends.locationSettings.e2eeNotice') }}
            </p>
          </div>
        </div>
      </div>
    </CardContent>
  </Card>
</template>
