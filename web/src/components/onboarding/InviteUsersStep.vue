<script setup lang="ts">
import { ref, inject, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUserService } from '@/services/user.service'
import { useAppService } from '@/services/app.service'
import type { Role } from '@/types/auth.types'
import InviteUserForm from '@/components/admin/InviteUserForm.vue'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Plus, Send, Check } from 'lucide-vue-next'
import { validateKey } from './types'

const { t } = useI18n()
const userService = useUserService()
const { toast } = useAppService()

const roles = ref<Role[]>([])
const formRefs = ref<InstanceType<typeof InviteUserForm>[]>([])
const formCount = ref(1)
const sending = ref(false)
const sentCount = ref(0)

const validation = inject(validateKey)

onMounted(async () => {
  roles.value = await userService.getRoles()
  validation?.register(() => true)
})

function addForm() {
  formCount.value++
}

async function sendInvites() {
  sending.value = true
  let sent = 0
  try {
    for (const form of formRefs.value) {
      if (!form) continue
      const result = await form.submit()
      if (!result) continue
      try {
        await userService.inviteUser(result as { firstName: string; lastName: string; email: string; roles: string[] })
        sent++
      } catch (e: any) {
        toast.error(e?.response?.data?.message ?? t('onboarding.invite.sendFailed'))
      }
    }
    if (sent > 0) {
      sentCount.value += sent
      toast.success(t('onboarding.invite.sent', { count: sent }))
      formCount.value = 1
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

    <div class="space-y-4">
      <div
        v-for="i in formCount"
        :key="i"
        class="rounded-lg border p-4"
        :class="formCount > 1 ? '' : 'border-transparent p-0'"
      >
        <InviteUserForm
          :ref="(el: any) => { if (el) formRefs[i - 1] = el }"
          :roles="roles"
        />
      </div>

      <Button
        variant="outline"
        size="sm"
        class="w-full"
        @click="addForm"
      >
        <Plus class="size-4 mr-1" />
        {{ t('onboarding.invite.addAnother') }}
      </Button>
    </div>

    <div class="flex items-center gap-3">
      <Button
        class="flex-1"
        :disabled="sending"
        @click="sendInvites"
      >
        <Spinner v-if="sending" class="size-4 mr-2" />
        <Send v-else class="size-4 mr-2" />
        {{ t('onboarding.invite.send') }}
      </Button>
    </div>

    <p
      v-if="sentCount > 0"
      class="text-sm text-center text-muted-foreground flex items-center justify-center gap-1"
    >
      <Check class="size-4 text-primary" />
      {{ t('onboarding.invite.sentSummary', { count: sentCount }) }}
    </p>
  </div>
</template>
