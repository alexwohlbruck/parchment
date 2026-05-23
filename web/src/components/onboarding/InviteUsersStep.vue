<script setup lang="ts">
import { ref, inject, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUserService } from '@/services/user.service'
import { useAppService } from '@/services/app.service'
import {
  TagsInput,
  TagsInputInput,
  TagsInputItem,
  TagsInputItemDelete,
  TagsInputItemText,
} from '@/components/ui/tags-input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Send, Check } from 'lucide-vue-next'
import { validateKey } from './types'

const { t } = useI18n()
const userService = useUserService()
const { toast } = useAppService()

const emails = ref<string[]>([])
const sending = ref(false)
const sentCount = ref(0)

const validation = inject(validateKey)

onMounted(() => {
  validation?.register(() => true)
})

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function handleUpdate(values: string[]) {
  emails.value = values.filter(isValidEmail)
}

async function sendInvites() {
  if (emails.value.length === 0) return
  sending.value = true
  let sent = 0
  try {
    for (const email of emails.value) {
      try {
        await userService.inviteUser({ email })
        sent++
      } catch (e: any) {
        toast.error(e?.response?.data?.message ?? t('onboarding.invite.sendFailed'))
      }
    }
    if (sent > 0) {
      sentCount.value += sent
      toast.success(t('onboarding.invite.sent', { count: sent }))
      emails.value = []
    }
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="text-center space-y-1">
      <h2 class="text-xl font-semibold">
        {{ t('onboarding.invite.title') }}
      </h2>
      <p class="text-sm text-muted-foreground">
        {{ t('onboarding.invite.description') }}
      </p>
    </div>

    <div class="flex flex-col gap-2">
      <Label>{{ t('onboarding.invite.emailLabel') }}</Label>
      <TagsInput
        :model-value="emails"
        :add-on-paste="true"
        :add-on-tab="true"
        :add-on-blur="true"
        class="min-h-24 items-start"
        @update:model-value="handleUpdate($event as string[])"
      >
        <TagsInputItem v-for="email in emails" :key="email" :value="email">
          <TagsInputItemText />
          <TagsInputItemDelete />
        </TagsInputItem>
        <TagsInputInput
          :placeholder="emails.length === 0 ? t('onboarding.invite.placeholder') : ''"
          @keydown.enter.prevent
        />
      </TagsInput>
    </div>

    <Button
      class="w-full"
      :disabled="sending || emails.length === 0"
      @click="sendInvites"
    >
      <Spinner v-if="sending" class="size-4 mr-2" />
      <Send v-else class="size-4 mr-2" />
      {{ t('onboarding.invite.send') }}
    </Button>

    <p
      v-if="sentCount > 0"
      class="text-sm text-center text-muted-foreground flex items-center justify-center gap-1"
    >
      <Check class="size-4 text-primary" />
      {{ t('onboarding.invite.sentSummary', { count: sentCount }) }}
    </p>
  </div>
</template>
