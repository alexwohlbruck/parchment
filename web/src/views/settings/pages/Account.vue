<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAuthStore } from '@/stores/auth.store'
import { storeToRefs } from 'pinia'
import { useAuthService } from '@/services/auth.service'
import { useUserService } from '@/services/user.service'
import { Avatar, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { SettingsSection } from '@/components/settings'
import { toast } from 'vue-sonner'
import { Check, Pencil } from 'lucide-vue-next'
import Passkeys from '@/components/auth/Passkeys.vue'
import Sessions from '@/components/auth/Sessions.vue'
import IdentitySettings from '@/components/friends/IdentitySettings.vue'

const authService = useAuthService()
const authStore = useAuthStore()
const userService = useUserService()

const { me } = storeToRefs(authStore)

const isEditingName = ref(false)
const isSavingName = ref(false)
const firstNameInput = ref('')
const lastNameInput = ref('')

const displayName = computed(() => {
  if (!me.value) return ''
  const first = me.value.firstName ?? ''
  const last = me.value.lastName ?? ''
  const joined = `${first} ${last}`.trim()
  return joined.length > 0 ? joined : 'Set your name'
})

const nameDirty = computed(() => {
  return (
    firstNameInput.value !== (me.value?.firstName ?? '') ||
    lastNameInput.value !== (me.value?.lastName ?? '')
  )
})

const nameValid = computed(() => {
  // Require at least one non-empty field. Both may have up to 64 chars.
  const f = firstNameInput.value.trim()
  const l = lastNameInput.value.trim()
  if (f.length === 0 && l.length === 0) return false
  if (f.length > 64 || l.length > 64) return false
  return true
})

function startEditName() {
  firstNameInput.value = me.value?.firstName ?? ''
  lastNameInput.value = me.value?.lastName ?? ''
  isEditingName.value = true
}

function cancelEditName() {
  isEditingName.value = false
}

async function saveName() {
  if (!nameValid.value || !nameDirty.value) return
  isSavingName.value = true
  try {
    await userService.updateMyProfile({
      firstName: firstNameInput.value.trim() || null,
      lastName: lastNameInput.value.trim() || null,
    })
    // Reflect the change locally — authStore.me is the single source of
    // truth consumed by this screen, the account dropdown, and any
    // friend-facing display.
    if (me.value) {
      authStore.updateUser({
        ...me.value,
        firstName: firstNameInput.value.trim() || undefined,
        lastName: lastNameInput.value.trim() || undefined,
      })
    }
    isEditingName.value = false
    toast.success('Name updated')
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Could not update your name'
    toast.error('Could not update your name', { description: message })
  } finally {
    isSavingName.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <template v-if="me">
      <SettingsSection :title="$t('settings.account.user.title')">
        <div class="flex items-center gap-2 w-full">
          <Avatar v-if="me.picture" size="sm">
            <AvatarImage :src="me.picture" :alt="me.email" />
          </Avatar>

          <!-- View mode -->
          <div v-if="!isEditingName" class="flex items-center gap-2 flex-1">
            <div class="flex flex-col text-nowrap">
              <span class="text-sm font-semibold leading-4">
                {{ displayName }}
              </span>
              <span class="text-xs text-gray-500 leading-4">
                {{ me.email }}
              </span>
            </div>
            <Button
              size="icon"
              variant="ghost"
              :icon="Pencil"
              aria-label="Edit name"
              @click="startEditName"
            />
          </div>

          <!-- Edit mode -->
          <div v-else class="flex flex-wrap items-center gap-2 flex-1">
            <Input
              v-model="firstNameInput"
              placeholder="First name"
              class="w-32"
              :disabled="isSavingName"
              @keyup.enter="saveName"
              @keyup.escape="cancelEditName"
            />
            <Input
              v-model="lastNameInput"
              placeholder="Last name"
              class="w-32"
              :disabled="isSavingName"
              @keyup.enter="saveName"
              @keyup.escape="cancelEditName"
            />
            <Button
              size="sm"
              :disabled="!nameValid || !nameDirty || isSavingName"
              @click="saveName"
            >
              <Spinner v-if="isSavingName" class="h-4 w-4" />
              <Check v-else class="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              :disabled="isSavingName"
              @click="cancelEditName"
            >
              Cancel
            </Button>
          </div>

          <Button
            v-if="!isEditingName"
            variant="destructive-outline"
            @click="authService.confirmAndSignOut()"
          >
            Sign out
          </Button>
        </div>
      </SettingsSection>

      <IdentitySettings />

      <Sessions />

      <Passkeys />
    </template>
  </div>
</template>
