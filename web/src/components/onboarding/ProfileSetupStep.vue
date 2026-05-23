<script setup lang="ts">
import { ref, inject, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth.store'
import { useUserService } from '@/services/user.service'
import { validateKey } from './types'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Avatar,
  AvatarImage,
  AvatarFallback,
} from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Camera, X } from 'lucide-vue-next'

const { t } = useI18n()
const authStore = useAuthStore()
const userService = useUserService()

const firstName = ref(authStore.me?.firstName ?? '')
const lastName = ref(authStore.me?.lastName ?? '')
const avatarPreview = ref<string | null>(authStore.me?.picture ?? null)
const avatarFile = ref<File | null>(null)
const uploading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

const initials = computed(() => {
  const f = firstName.value?.[0] ?? ''
  const l = lastName.value?.[0] ?? ''
  return (f + l).toUpperCase() || '?'
})

const validation = inject(validateKey)

onMounted(() => {
  validation?.register(validate)
})

async function validate(): Promise<boolean> {
  if (!firstName.value.trim()) return false

  try {
    uploading.value = true

    await userService.updateMyProfile({
      firstName: firstName.value.trim(),
      lastName: lastName.value.trim() || null,
    })

    if (avatarFile.value) {
      await userService.uploadAvatar(avatarFile.value)
    }

    authStore.updateUser({
      ...authStore.me!,
      firstName: firstName.value.trim(),
      lastName: lastName.value.trim() || undefined,
    })

    return true
  } catch {
    return false
  } finally {
    uploading.value = false
  }
}

function triggerFileInput() {
  fileInput.value?.click()
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return
  if (file.size > 2 * 1024 * 1024) return

  avatarFile.value = file
  avatarPreview.value = URL.createObjectURL(file)
}

function removeAvatar() {
  avatarFile.value = null
  avatarPreview.value = null
  if (fileInput.value) fileInput.value.value = ''
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="text-center space-y-1">
      <h2 class="text-xl font-semibold">
        {{ t('onboarding.profile.title') }}
      </h2>
      <p class="text-sm text-muted-foreground">
        {{ t('onboarding.profile.description') }}
      </p>
    </div>

    <!-- Avatar picker -->
    <div class="flex justify-center">
      <div class="relative group">
        <Avatar size="lg" shape="circle">
          <AvatarImage v-if="avatarPreview" :src="avatarPreview" />
          <AvatarFallback class="text-3xl">{{ initials }}</AvatarFallback>
        </Avatar>

        <button
          type="button"
          class="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-white opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
          @click="triggerFileInput"
        >
          <Camera class="h-6 w-6" />
        </button>

        <button
          v-if="avatarPreview"
          type="button"
          class="absolute -top-1 -right-1 rounded-full bg-destructive text-destructive-foreground p-0.5 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
          @click="removeAvatar"
        >
          <X class="h-3 w-3" />
        </button>

        <input
          ref="fileInput"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          class="hidden"
          @change="onFileChange"
        />
      </div>
    </div>

    <!-- Name fields -->
    <div class="grid grid-cols-2 gap-4">
      <div class="flex flex-col gap-2">
        <Label for="firstName">{{ t('onboarding.profile.firstName') }}</Label>
        <Input
          id="firstName"
          v-model="firstName"
          :placeholder="t('onboarding.profile.firstNamePlaceholder')"
          autofocus
        />
      </div>
      <div class="flex flex-col gap-2">
        <Label for="lastName">{{ t('onboarding.profile.lastName') }}</Label>
        <Input
          id="lastName"
          v-model="lastName"
          :placeholder="t('onboarding.profile.lastNamePlaceholder')"
        />
      </div>
    </div>
  </div>
</template>
