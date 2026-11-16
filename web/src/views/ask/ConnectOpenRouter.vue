<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useOpenRouterConnect } from '@/services/ask/openrouter-connect.service'
import ErrorMessage from '@/components/ErrorMessage.vue'
import { Spinner } from '@/components/ui/spinner'
import { AppRoute } from '@/router'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { complete } = useOpenRouterConnect()
const failed = ref(false)

onMounted(async () => {
  const code = route.query.code
  if (typeof code !== 'string') {
    failed.value = true
    return
  }
  try {
    const returnTo = await complete(code, route.query.state as string | undefined)
    router.replace(returnTo)
  } catch {
    failed.value = true
  }
})
</script>

<template>
  <div class="pt-4 px-4">
    <ErrorMessage
      v-if="failed"
      type="error"
      :title="t('ask.connect.failed')"
      :button-text="t('ask.locked.addKey')"
      @action="router.replace({ name: AppRoute.INTEGRATIONS })"
    />
    <div v-else class="py-12 flex flex-col items-center gap-2 text-sm text-muted-foreground">
      <Spinner size="icon" />
      <span>{{ t('ask.connect.connecting') }}</span>
    </div>
  </div>
</template>
