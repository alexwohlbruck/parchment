<script setup lang="ts">
import { ref, computed, inject, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useIdentityStore } from '@/stores/identity.store'
import { validateKey } from './types'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AtSign } from 'lucide-vue-next'

const { t } = useI18n()
const identityStore = useIdentityStore()
const { domain } = storeToRefs(identityStore)

const aliasInput = ref('')
const error = ref<string | null>(null)
const saving = ref(false)

const isValid = computed(() => /^[a-zA-Z0-9_]{3,30}$/.test(aliasInput.value))

const handlePreview = computed(() => {
  if (!aliasInput.value || !domain.value) return null
  return `${aliasInput.value}@${domain.value}`
})

const validation = inject(validateKey)

onMounted(() => {
  validation?.register(validate)
})

async function validate(): Promise<boolean> {
  if (!isValid.value) {
    error.value = t('onboarding.alias.validationError')
    return false
  }

  saving.value = true
  error.value = null

  try {
    const result = await identityStore.updateAlias(aliasInput.value)
    if (result.success) return true
    error.value = result.error || t('onboarding.alias.saveFailed')
    return false
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="text-center space-y-1">
      <h2 class="text-xl font-semibold">
        {{ t('onboarding.alias.title') }}
      </h2>
      <p class="text-sm text-muted-foreground">
        {{ t('onboarding.alias.description') }}
      </p>
    </div>

    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-2">
        <Label for="alias">{{ t('onboarding.alias.label') }}</Label>
        <div class="relative">
          <AtSign class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            id="alias"
            v-model="aliasInput"
            class="pl-9"
            :placeholder="t('onboarding.alias.placeholder')"
            autofocus
            :disabled="saving"
          />
        </div>
        <p class="text-xs text-muted-foreground">
          {{ t('onboarding.alias.hint') }}
        </p>
      </div>

      <div
        v-if="handlePreview && isValid"
        class="rounded-md border p-3 text-center"
      >
        <p class="text-xs text-muted-foreground mb-1">
          {{ t('onboarding.alias.previewLabel') }}
        </p>
        <p class="font-mono text-sm">{{ handlePreview }}</p>
      </div>

      <Alert v-if="error" variant="destructive">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>
    </div>
  </div>
</template>
