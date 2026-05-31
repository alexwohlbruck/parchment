<script setup lang="ts">
import { ref, inject, onMounted, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { z } from 'zod'
import { useDebounceFn } from '@vueuse/core'
import { useAuthStore } from '@/stores/auth.store'
import { useUserService } from '@/services/user.service'
import { useIdentityStore } from '@/stores/identity.store'
import { validateKey } from './types'
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Camera, X, Loader2, CircleCheck, CircleAlert } from 'lucide-vue-next'

const { t } = useI18n()
const authStore = useAuthStore()
const userService = useUserService()
const identityStore = useIdentityStore()
const { domain } = storeToRefs(identityStore)

const schema = toTypedSchema(
  z.object({
    firstName: z.string().min(1, t('onboarding.profile.firstName')),
    lastName: z.string().optional(),
  }),
)

const { validate: validateForm, values } = useForm({
  validationSchema: schema,
  initialValues: {
    firstName: authStore.me?.firstName ?? '',
    lastName: authStore.me?.lastName ?? '',
  },
})

const avatarPreview = ref<string | null>(authStore.me?.picture || null)
const avatarFile = ref<File | null>(null)
const uploading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

const aliasInput = ref('')
const aliasEdited = ref(false)
const aliasError = ref<string | null>(null)
const aliasChecking = ref(false)
const aliasAvailable = ref<boolean | null>(null)

const isAliasValid = computed(() =>
  /^[a-zA-Z0-9_]{3,30}$/.test(aliasInput.value),
)

const autoAlias = computed(() =>
  `${values.firstName || ''}${values.lastName || ''}`
    .replace(/\s/g, '')
    .toLowerCase(),
)

watch(
  autoAlias,
  val => {
    if (!aliasEdited.value) aliasInput.value = val
  },
  { immediate: true },
)

const checkAliasAvailability = useDebounceFn(async (alias: string) => {
  if (!isAliasValid.value) {
    aliasAvailable.value = null
    aliasChecking.value = false
    return
  }

  try {
    const available = await userService.checkAliasAvailability(alias)
    if (aliasInput.value === alias) {
      aliasAvailable.value = available
      aliasError.value = available ? null : t('onboarding.alias.aliasTaken')
    }
  } catch {
    aliasAvailable.value = null
  } finally {
    aliasChecking.value = false
  }
}, 400)

watch(aliasInput, val => {
  aliasError.value = null
  aliasAvailable.value = null
  if (isAliasValid.value) {
    aliasChecking.value = true
    checkAliasAvailability(val)
  }
})

function onAliasInput(e: Event) {
  const val = (e.target as HTMLInputElement).value
  aliasEdited.value = true
  aliasInput.value = val
}

const COLUMBUS_AVATAR =
  'https://api.dicebear.com/9.x/open-peeps/svg?seed=f&accessories=eyepatch&skinColor=d08b5b&accessoriesProbability=100&face=driven&facialHair=moustache1&facialHairProbability=100&head=hatHip&backgroundColor=b6e3f4'

const placeholderAvatar = computed(() => {
  if (!aliasInput.value) return COLUMBUS_AVATAR
  const seed = aliasInput.value
  return `https://api.dicebear.com/9.x/open-peeps/svg?seed=${encodeURIComponent(seed)}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`
})

const validation = inject(validateKey)

onMounted(() => {
  validation?.register(validateStep)
})

async function validateStep(): Promise<boolean> {
  const { valid } = await validateForm()
  if (!valid) return false

  if (!isAliasValid.value) {
    aliasError.value = t('onboarding.alias.validationError')
    return false
  }

  if (aliasChecking.value) {
    await new Promise<void>(resolve => {
      const stop = watch(aliasChecking, v => {
        if (!v) {
          stop()
          resolve()
        }
      })
    })
  }

  if (aliasAvailable.value === false) {
    aliasError.value = t('onboarding.alias.aliasTaken')
    return false
  }

  try {
    uploading.value = true
    aliasError.value = null

    await userService.updateMyProfile({
      firstName: (values.firstName || '').trim(),
      lastName: (values.lastName || '').trim() || null,
      picture: avatarFile.value ? undefined : placeholderAvatar.value,
    })

    if (avatarFile.value) {
      await userService.uploadAvatar(avatarFile.value)
    }

    const aliasResult = await identityStore.updateAlias(aliasInput.value)
    if (!aliasResult.success) {
      aliasError.value = aliasResult.error || t('onboarding.alias.saveFailed')
      return false
    }

    authStore.updateUser({
      ...authStore.me!,
      firstName: (values.firstName || '').trim(),
      lastName: (values.lastName || '').trim() || undefined,
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

  if (avatarPreview.value?.startsWith('blob:')) {
    URL.revokeObjectURL(avatarPreview.value)
  }
  avatarFile.value = file
  avatarPreview.value = URL.createObjectURL(file)
}

function removeAvatar() {
  if (avatarPreview.value?.startsWith('blob:')) {
    URL.revokeObjectURL(avatarPreview.value)
  }
  avatarFile.value = null
  avatarPreview.value = null
  if (fileInput.value) fileInput.value.value = ''
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="text-center space-y-1">
      <h2 class="text-2xl font-semibold">
        {{ t('onboarding.profile.title') }}
      </h2>
      <p class="text-sm text-muted-foreground">
        {{ t('onboarding.profile.description') }}
      </p>
    </div>

    <!-- Avatar picker -->
    <div class="flex justify-center">
      <button
        type="button"
        class="avatar-picker group relative size-28 rounded-full overflow-hidden cursor-pointer ring-2 ring-border ring-offset-2 ring-offset-background focus-visible:ring-ring"
        @click="triggerFileInput"
      >
        <div
          class="size-full rounded-full overflow-hidden flex items-center justify-center ring-1 ring-border bg-secondary"
        >
          <img
            :src="avatarPreview || placeholderAvatar"
            class="size-full object-cover"
            alt=""
          />
        </div>

        <div
          class="absolute inset-0 rounded-full flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
        >
          <Camera class="size-5 text-white drop-shadow-sm" />
        </div>

        <div
          v-if="avatarPreview"
          role="button"
          tabindex="0"
          :aria-label="t('onboarding.profile.removeAvatar')"
          class="absolute -top-0.5 -right-0.5 size-6 rounded-full bg-background ring-1 ring-border shadow-sm flex items-center justify-center text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all duration-200 cursor-pointer z-10"
          @click.stop="removeAvatar"
          @keydown.enter.stop="removeAvatar"
        >
          <X class="size-3" />
        </div>

        <input
          ref="fileInput"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          class="hidden"
          @change="onFileChange"
        />
      </button>
    </div>

    <form class="flex flex-col gap-4" @submit.prevent>
      <!-- Name fields -->
      <div class="grid grid-cols-2 gap-4">
        <FormField v-slot="{ componentField }" name="firstName">
          <FormItem>
            <FormLabel>{{ t('onboarding.profile.firstName') }}</FormLabel>
            <FormControl>
              <Input
                v-bind="componentField"
                :placeholder="t('onboarding.profile.firstNamePlaceholder')"
                autofocus
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        </FormField>

        <FormField v-slot="{ componentField }" name="lastName">
          <FormItem>
            <FormLabel>{{ t('onboarding.profile.lastName') }}</FormLabel>
            <FormControl>
              <Input
                v-bind="componentField"
                :placeholder="t('onboarding.profile.lastNamePlaceholder')"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        </FormField>
      </div>

      <!-- Username -->
      <div class="flex flex-col gap-2">
        <label for="alias" class="text-sm font-medium leading-none">
          {{ t('onboarding.alias.label') }}
        </label>
        <div
          class="flex items-center rounded-md border text-sm ring-offset-background transition-shadow focus-within:ring-1 focus-within:ring-inset focus-within:ring-ring"
          :class="aliasError ? 'border-destructive' : 'border-input'"
        >
          <span class="pl-3 text-muted-foreground select-none shrink-0">@</span>
          <input
            id="alias"
            :value="aliasInput"
            class="flex-1 bg-transparent px-1 py-2 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            :placeholder="t('onboarding.alias.placeholder')"
            :disabled="uploading"
            @input="onAliasInput"
          />
          <Loader2
            v-if="aliasChecking"
            class="size-4 mr-3 text-muted-foreground animate-spin shrink-0"
          />
          <CircleCheck
            v-else-if="aliasAvailable === true && isAliasValid"
            class="size-4 mr-3 text-forest-500 shrink-0"
          />
          <CircleAlert
            v-else-if="aliasAvailable === false"
            class="size-4 mr-3 text-destructive shrink-0"
          />
          <span
            v-if="domain"
            class="pr-3 text-muted-foreground select-none shrink-0"
            >@{{ domain }}</span
          >
        </div>
        <p v-if="aliasError" class="text-sm font-medium text-destructive">
          {{ aliasError }}
        </p>
        <p v-else class="text-xs text-muted-foreground">
          {{ t('onboarding.alias.hint') }}
        </p>
      </div>
    </form>
  </div>
</template>
