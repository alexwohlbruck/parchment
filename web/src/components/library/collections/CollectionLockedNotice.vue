<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { LockIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import RecoveryKeyDialog from '@/components/identity/RecoveryKeyDialog.vue'
import { useIdentityStore } from '@/stores/identity.store'
import { useFriendsStore } from '@/stores/friends.store'
import type { Collection } from '@/types/library.types'

const props = defineProps<{ collection: Collection }>()

const emit = defineEmits<{
  (e: 'unlocked'): void
}>()

const { t } = useI18n()
const identityStore = useIdentityStore()
const friendsStore = useFriendsStore()
const unlocking = ref(false)

/**
 * Importing a key only helps when this device lacks one. A shared collection
 * whose envelope holds no usable key needs its owner to share again.
 */
const sharer = computed(() => {
  const handle = props.collection.senderHandle
  if (!handle || !identityStore.isSetupComplete) return null
  const friend = friendsStore.friends.find(f => f.friendHandle === handle)
  return friend?.friendName || handle.split('@')[0]
})
</script>

<template>
  <div class="flex flex-col items-center text-center gap-3 px-6 py-8">
    <div class="rounded-full bg-muted p-3 text-muted-foreground">
      <LockIcon class="size-5" />
    </div>
    <div class="space-y-1 max-w-xs">
      <p class="text-sm font-medium">
        {{ t('library.entities.collections.lockedNotice.title') }}
      </p>
      <p class="text-sm text-muted-foreground">
        {{
          sharer
            ? t('library.entities.collections.lockedNotice.reshare', { name: sharer })
            : t('library.entities.collections.lockedNotice.description')
        }}
      </p>
    </div>
    <Button v-if="!sharer" variant="outline" size="sm" @click="unlocking = true">
      {{ t('library.entities.collections.lockedNotice.unlock') }}
    </Button>

    <RecoveryKeyDialog
      v-model:open="unlocking"
      mode="import"
      @complete="emit('unlocked')"
    />
  </div>
</template>
