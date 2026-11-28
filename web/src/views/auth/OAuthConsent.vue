<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import ScopePicker from '@/components/auth/ScopePicker.vue'
import { useAuthStore } from '@/stores/auth.store'
import { toast } from '@/lib/toast'
import {
  approveAuthorization,
  describeAuthorization,
  type AuthorizationQuery,
} from '@/services/auth/oauth.service'
import type { AuthorizationRequestDetails, TokenScope } from '@/types/access-token.types'

const route = useRoute()
const { t } = useI18n()
const { me } = storeToRefs(useAuthStore())

const query = computed<AuthorizationQuery>(() =>
  Object.fromEntries(
    Object.entries(route.query).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  ),
)

const details = shallowRef<AuthorizationRequestDetails | null>(null)
const failed = ref(false)
const scopes = ref<TokenScope[]>([])
const approving = ref(false)

onMounted(async () => {
  try {
    details.value = await describeAuthorization(query.value)
    scopes.value = [...details.value.scopes]
  } catch {
    failed.value = true
  }
})

async function allow() {
  if (!scopes.value.length || approving.value) return
  approving.value = true
  try {
    window.location.assign(await approveAuthorization(query.value, scopes.value))
  } catch (error) {
    approving.value = false
    toast.error(t('oauthConsent.failed'), { cause: error })
  }
}

function cancel() {
  if (details.value) window.location.assign(details.value.denyUrl)
}
</script>

<template>
  <div class="flex h-full items-center justify-center overflow-y-auto bg-background p-6">
    <div class="w-full max-w-sm space-y-6">
      <div class="flex justify-center">
        <img src="@/assets/parchment.svg" alt="Parchment" class="size-12 dark:invert" />
      </div>

      <div v-if="failed" class="space-y-1 text-center">
        <h1 class="text-xl font-semibold">{{ t('oauthConsent.invalidTitle') }}</h1>
        <p class="text-sm text-muted-foreground">{{ t('oauthConsent.invalidDescription') }}</p>
      </div>

      <div v-else-if="!details" class="flex justify-center py-6">
        <Spinner />
      </div>

      <template v-else>
        <div class="space-y-1 text-center">
          <h1 class="text-xl font-semibold" data-testid="consent-title">
            {{ t('oauthConsent.title', { name: details.client.name }) }}
          </h1>
          <p v-if="me" class="text-sm text-muted-foreground">
            {{ t('oauthConsent.signedInAs', { email: me.email }) }}
          </p>
        </div>

        <div class="space-y-2">
          <p class="text-sm font-medium">{{ t('oauthConsent.canDo') }}</p>
          <ScopePicker v-model="scopes" :scopes="details.scopes" />
        </div>

        <div class="space-y-3">
          <div class="flex gap-2">
            <Button variant="ghost" class="flex-1" :disabled="approving" @click="cancel">
              {{ t('oauthConsent.cancel') }}
            </Button>
            <Button class="flex-1" :disabled="!scopes.length || approving" @click="allow">
              <Spinner v-if="approving" class="size-4" />
              {{ t('oauthConsent.allow') }}
            </Button>
          </div>
          <p class="text-center text-xs text-muted-foreground">
            {{ t('oauthConsent.returnsTo', { host: details.client.redirectHost }) }}
          </p>
        </div>
      </template>
    </div>
  </div>
</template>
