<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CopyIcon, CheckIcon } from 'lucide-vue-next'
import ResponsiveDialog from '@/components/responsive/ResponsiveDialog.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import ScopePicker from '@/components/auth/ScopePicker.vue'
import { useClipboard } from '@/composables/useClipboard'
import { toast } from '@/lib/toast'
import { createAccessToken } from '@/services/auth/access-token.service'
import {
  PERSONAL_TOKEN_DAYS,
  TOKEN_SCOPES,
  type CreatedAccessToken,
  type PersonalTokenLifetime,
  type TokenScope,
} from '@/types/access-token.types'

const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ created: [token: CreatedAccessToken] }>()

const { t } = useI18n()
const { copy, copied } = useClipboard()

const NEVER = 'never'
const DEFAULT_SCOPES = TOKEN_SCOPES.filter(scope => scope.endsWith(':read'))
const lifetimeOptions = [...PERSONAL_TOKEN_DAYS.map(String), NEVER]

const name = ref('')
const scopes = ref<TokenScope[]>([...DEFAULT_SCOPES])
const lifetime = ref('90')
const submitting = ref(false)
const created = ref<CreatedAccessToken | null>(null)

const canSubmit = computed(() => name.value.trim().length > 0 && scopes.value.length > 0)

watch(open, isOpen => {
  if (!isOpen) return
  name.value = ''
  scopes.value = [...DEFAULT_SCOPES]
  lifetime.value = '90'
  created.value = null
})

async function submit() {
  if (!canSubmit.value || submitting.value) return
  submitting.value = true
  try {
    created.value = await createAccessToken({
      name: name.value.trim(),
      scopes: scopes.value,
      expiresInDays: (lifetime.value === NEVER ? null : Number(lifetime.value)) as PersonalTokenLifetime,
    })
    emit('created', created.value)
  } catch (error) {
    toast.error(t('settings.auth.tokens.dialog.failed'), { cause: error })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <ResponsiveDialog
    v-model:open="open"
    :title="created ? t('settings.auth.tokens.dialog.createdTitle') : t('settings.auth.tokens.dialog.title')"
    :description="created ? t('settings.auth.tokens.dialog.createdDescription') : undefined"
    content-class="sm:max-w-md"
    fit-content
    modal
    :z-index-offset="10"
  >
    <template #content>
      <div v-if="created" class="flex flex-col gap-4">
        <div class="flex items-center gap-2 rounded-lg border bg-muted/50 p-2 pl-3">
          <code class="flex-1 break-all font-mono text-sm" data-testid="created-token">{{ created.secret }}</code>
          <Button
            size="sm"
            variant="outline"
            :icon="copied ? CheckIcon : CopyIcon"
            @click="copy(created.secret, t('settings.auth.tokens.dialog.copied'))"
          >
            {{ t('settings.auth.tokens.dialog.copy') }}
          </Button>
        </div>
        <div class="flex justify-end">
          <Button @click="open = false">{{ t('general.done') }}</Button>
        </div>
      </div>

      <form v-else class="flex flex-col gap-4" @submit.prevent="submit">
        <div class="flex flex-col gap-2">
          <Label for="token-name">{{ t('settings.auth.tokens.dialog.name') }}</Label>
          <Input
            id="token-name"
            v-model="name"
            :placeholder="t('settings.auth.tokens.dialog.namePlaceholder')"
            maxlength="60"
            autofocus
          />
        </div>

        <div class="flex flex-col gap-2">
          <Label>{{ t('settings.auth.tokens.dialog.scopes') }}</Label>
          <ScopePicker v-model="scopes" :scopes="TOKEN_SCOPES" />
        </div>

        <div class="flex items-center justify-between gap-2">
          <Label>{{ t('settings.auth.tokens.dialog.lifetime') }}</Label>
          <Select v-model="lifetime">
            <SelectTrigger class="w-fit">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem v-for="option in lifetimeOptions" :key="option" :value="option">
                  {{ t(`settings.auth.tokens.dialog.lifetimes.${option}`) }}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <div class="flex justify-end">
          <Button type="submit" :disabled="!canSubmit || submitting">
            <Spinner v-if="submitting" class="size-4" />
            {{ t('settings.auth.tokens.dialog.submit') }}
          </Button>
        </div>
      </form>
    </template>
  </ResponsiveDialog>
</template>
